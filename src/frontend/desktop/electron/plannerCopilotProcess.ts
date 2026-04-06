import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

import { REPO_ROOT } from './paths';
import type { PlannerCopilotInvocation } from './plannerSession.types';

type PlannerAgentRegistryEntry = {
  agent_id: string;
  required_model?: string;
  allowed_dirs?: string[];
};

type PlannerAgentRegistry = {
  agents?: PlannerAgentRegistryEntry[];
};

export type BuildPlannerCopilotInvocationOptions = {
  prompt: string;
  resumeSessionId?: string | null;
  plannerSessionId?: string | null;
  promptMode?: 'interactive' | 'one-shot';
  allowedRoots?: string[];
  workingDirectory?: string;
  contextPackBoundaryEnforced?: boolean;
  additionalEnv?: NodeJS.ProcessEnv;
};

type BuildPlannerLaunchArgsOptions = {
  model: string;
  allowedRoots: string[];
  resumeSessionId?: string | null;
  contextPackBoundaryEnforced: boolean;
  prompt?: string;
  promptMode?: 'interactive' | 'one-shot';
};

const ARTIFACT_AUTHOR_ALLOW_TOOLS = ['write'];
const ARTIFACT_AUTHOR_DENY_TOOLS = [
  'shell(git add)',
  'shell(git commit)',
  'shell(git push)',
  'shell(gh pr create)',
  'shell(rm:*)',
  'shell(sudo)',
  'shell(su)',
  'shell(doas)',
  'shell(chown:*)',
  'shell',
];

let cachedPlannerRegistryEntry: PlannerAgentRegistryEntry | null = null;

function loadPlanningAgentRegistryEntry(): PlannerAgentRegistryEntry {
  if (cachedPlannerRegistryEntry) {
    return cachedPlannerRegistryEntry;
  }

  const registryPath = join(REPO_ROOT, '.github/agents/registry.json');
  const registryPayload = JSON.parse(readFileSync(registryPath, 'utf-8')) as PlannerAgentRegistry;
  const planningAgent = registryPayload.agents?.find((entry) => entry.agent_id === 'planning-agent');

  if (!planningAgent?.required_model) {
    throw new Error('Planning agent registry entry is missing required_model.');
  }

  cachedPlannerRegistryEntry = planningAgent;
  return planningAgent;
}

export function getPlanningAgentRequiredModel(): string {
  return loadPlanningAgentRegistryEntry().required_model ?? 'gpt-4.1';
}

export function getPlanningAgentAllowedRoots(): string[] {
  return [...(loadPlanningAgentRegistryEntry().allowed_dirs ?? ['.'])];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function resolvePlannerWorkingDirectory(
  _allowedRoots: string[],
  _workingDirectory?: string,
): string {
  // CWD must be REPO_ROOT so Copilot discovers .github/agents/planning-agent.md.
  // External repos are accessible via --add-dir, not via CWD.
  return REPO_ROOT;
}

function resolvePlannerAllowedDirsForArgs(allowedRoots: string[]): string[] {
  return allowedRoots.map((root) => (isAbsolute(root) ? root : join(REPO_ROOT, root)));
}

function buildPlannerLaunchArgs(
  options: BuildPlannerLaunchArgsOptions,
): string[] {
  const args = [
    '--agent', 'planning-agent',
    '--model', options.model,
    '--no-ask-user',
    ...ARTIFACT_AUTHOR_ALLOW_TOOLS.flatMap((tool) => ['--allow-tool', tool]),
    ...ARTIFACT_AUTHOR_DENY_TOOLS.flatMap((tool) => ['--deny-tool', tool]),
    ...options.allowedRoots.flatMap((root) => ['--add-dir', root]),
    ...(options.contextPackBoundaryEnforced ? ['--disallow-temp-dir'] : []),
    ...(options.resumeSessionId ? [`--resume=${options.resumeSessionId}`] : []),
  ];

  args.push('--output-format', 'json', '--stream', 'on');

  if (options.prompt !== undefined) {
    if ((options.promptMode ?? 'one-shot') === 'interactive') {
      args.push('-i', options.prompt);
    } else {
      args.push('--prompt', options.prompt);
    }
  }

  return args;
}

export function buildPlannerCopilotInvocation(
  options: BuildPlannerCopilotInvocationOptions,
): PlannerCopilotInvocation {
  const allowedRoots = dedupe(options.allowedRoots ?? getPlanningAgentAllowedRoots());
  const allowedDirsForArgs = resolvePlannerAllowedDirsForArgs(allowedRoots);
  const contextPackBoundaryEnforced =
    options.contextPackBoundaryEnforced ?? allowedRoots.length > 0;
  const model = getPlanningAgentRequiredModel();
  const resumeSessionId = options.resumeSessionId ?? null;
  const plannerSessionId = options.plannerSessionId ?? null;
  const promptMode = options.promptMode ?? 'one-shot';

  return {
    command: 'copilot',
    args: buildPlannerLaunchArgs({
      model,
      allowedRoots: allowedDirsForArgs,
      resumeSessionId,
      contextPackBoundaryEnforced,
      prompt: options.prompt,
      promptMode,
    }),
    cwd: resolvePlannerWorkingDirectory(allowedRoots, options.workingDirectory),
    env: {
      ...process.env,
      RUN_ROLE_AGENT_ACTIVE_MODEL: model,
      COPILOT_MODEL: model,
      ...(plannerSessionId ? { PLANNER_SESSION_ID: plannerSessionId } : {}),
      ...options.additionalEnv,
    },
    agentId: 'planning-agent',
    model,
    outputFormat: 'json',
    streamMode: 'on',
    prompt: options.prompt,
    promptMode,
    resumeSessionId,
    plannerSessionId,
    allowedRoots,
    contextPackBoundaryEnforced,
  };
}

export function spawnPlannerCopilotProcess(
  options: BuildPlannerCopilotInvocationOptions,
  spawnProcess: typeof spawn = spawn,
): ChildProcess {
  const invocation = buildPlannerCopilotInvocation(options);
  return spawnProcess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
