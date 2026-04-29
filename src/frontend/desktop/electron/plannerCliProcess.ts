import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { getActiveProvider, type CliProvider } from '../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from './paths';
import type { PlannerCliInvocation } from './plannerSession.types';

type PlannerAgentRegistryEntry = {
  agent_id: string;
  required_model?: string;
  allowed_dirs?: string[];
};

type PlannerAgentRegistry = {
  agents?: PlannerAgentRegistryEntry[];
};

export type BuildPlannerCliInvocationOptions = {
  prompt: string;
  resumeSessionId?: string | null;
  plannerSessionId?: string | null;
  promptMode?: 'interactive' | 'one-shot';
  allowedRoots?: string[];
  workingDirectory?: string;
  contextPackBoundaryEnforced?: boolean;
  additionalEnv?: NodeJS.ProcessEnv;
};

let cachedPlannerRegistryEntry: { registryPath: string; entry: PlannerAgentRegistryEntry } | null = null;

function loadProviderPlanningAgentRegistryEntry(provider: CliProvider): PlannerAgentRegistryEntry {
  const registryPath = join(REPO_ROOT, provider.agentConfigPaths().registry);
  if (cachedPlannerRegistryEntry?.registryPath === registryPath) {
    return cachedPlannerRegistryEntry.entry;
  }

  const registryPayload = JSON.parse(readFileSync(registryPath, 'utf-8')) as PlannerAgentRegistry;
  const planningAgent = registryPayload.agents?.find((entry) => entry.agent_id === 'planning-agent');

  if (!planningAgent?.required_model) {
    throw new Error('Planning agent registry entry is missing required_model.');
  }

  cachedPlannerRegistryEntry = { registryPath, entry: planningAgent };
  return planningAgent;
}

export function getPlanningAgentRequiredModel(): string {
  const provider = getActiveProvider(REPO_ROOT);
  return loadProviderPlanningAgentRegistryEntry(provider).required_model ?? 'gpt-4.1';
}

export function getPlanningAgentAllowedRoots(): string[] {
  const provider = getActiveProvider(REPO_ROOT);
  return [...(loadProviderPlanningAgentRegistryEntry(provider).allowed_dirs ?? ['.'])];
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

export function buildPlannerCliInvocation(
  options: BuildPlannerCliInvocationOptions,
): PlannerCliInvocation {
  const provider = getActiveProvider(REPO_ROOT);
  const allowedRoots = dedupe(options.allowedRoots ?? getPlanningAgentAllowedRoots());
  const contextPackBoundaryEnforced =
    options.contextPackBoundaryEnforced ?? allowedRoots.length > 0;
  const model = loadProviderPlanningAgentRegistryEntry(provider).required_model ?? 'gpt-4.1';
  const resumeSessionId = options.resumeSessionId ?? null;
  const plannerSessionId = options.plannerSessionId ?? null;
  const promptMode = options.promptMode ?? 'one-shot';
  const buildLaunchSpec = provider.buildPlannerLaunchSpec;

  if (!buildLaunchSpec) {
    throw new Error(`Active provider "${provider.id}" does not support planner CLI sessions.`);
  }

  const launchSpec = buildLaunchSpec({
    model,
    resumeSessionId,
    plannerSessionId,
    prompt: options.prompt,
    promptMode,
    allowedRoots,
    contextPackBoundaryEnforced,
    workingDirectory: options.workingDirectory ?? REPO_ROOT,
  });

  if (!launchSpec) {
    throw new Error(`Active provider "${provider.id}" does not support planner CLI sessions.`);
  }

  return {
    command: provider.resolveCommand(),
    args: launchSpec.args,
    cwd: launchSpec.launchCwd,
    env: {
      ...process.env,
      RUN_ROLE_AGENT_ACTIVE_MODEL: model,
      ...(plannerSessionId ? { PLANNER_SESSION_ID: plannerSessionId } : {}),
      ...launchSpec.env,
      ...options.additionalEnv,
    },
    agentId: 'planning-agent',
    model,
    prompt: options.prompt,
    promptMode,
    resumeSessionId,
    plannerSessionId,
    allowedRoots,
    contextPackBoundaryEnforced,
  };
}

export function spawnPlannerCliProcess(
  options: BuildPlannerCliInvocationOptions,
  spawnProcess: typeof spawn = spawn,
): ChildProcess {
  const invocation = buildPlannerCliInvocation(options);
  return spawnProcess(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
