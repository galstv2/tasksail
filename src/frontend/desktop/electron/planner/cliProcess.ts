import { readFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

import { getActiveProvider, type CliProvider } from '../../../../backend/platform/cli-provider/index.js';
import type {
  GenericAgentEnv,
  PlannerLaunchExtensionDirs,
} from '../../../../backend/platform/cli-provider/types.js';
import type { PlannerPersonalityId } from '../../src/shared/desktopContract';
import { REPO_ROOT } from '../paths';
import type { PlannerCliInvocation } from './session.types';

type PlannerAgentRegistryEntry = {
  agent_id: string;
  required_model?: string;
  reasoning_effort?: string;
  allowed_dirs?: string[];
};

type PlannerAgentRegistry = {
  agents?: PlannerAgentRegistryEntry[];
};

export type BuildPlannerCliInvocationOptions = {
  prompt: string;
  reasoningEffort?: string;
  resumeSessionId?: string | null;
  plannerSessionId?: string | null;
  promptMode?: 'interactive' | 'one-shot';
  allowedRoots?: string[];
  workingDirectory?: string;
  contextPackBoundaryEnforced?: boolean;
  additionalEnv?: NodeJS.ProcessEnv;
  focusEnv?: Omit<GenericAgentEnv, 'model' | 'agentId'>;
  plannerPersonalityId?: PlannerPersonalityId;
  launchExtensions?: PlannerLaunchExtensionDirs;
};

let cachedPlannerRegistryEntry: { registryPath: string; plannerAgentId: string; entry: PlannerAgentRegistryEntry } | null = null;

function loadProviderPlanningAgentRegistryEntry(provider: CliProvider, plannerAgentId: string): PlannerAgentRegistryEntry {
  const registryPath = join(REPO_ROOT, provider.agentConfigPaths().registry);
  if (
    cachedPlannerRegistryEntry?.registryPath === registryPath
    && cachedPlannerRegistryEntry.plannerAgentId === plannerAgentId
  ) {
    return cachedPlannerRegistryEntry.entry;
  }

  const registryPayload = JSON.parse(readFileSync(registryPath, 'utf-8')) as PlannerAgentRegistry;
  const planningAgent = registryPayload.agents?.find((entry) => entry.agent_id === plannerAgentId);

  if (!planningAgent?.required_model) {
    throw new Error('Planning agent registry entry is missing required_model.');
  }

  cachedPlannerRegistryEntry = { registryPath, plannerAgentId, entry: planningAgent };
  return planningAgent;
}

export function getPlanningAgentRequiredModel(): string {
  const provider = getActiveProvider(REPO_ROOT);
  const plannerAgentId = provider.plannerAgentId();
  if (!plannerAgentId) {
    throw new Error('Active provider has no planner agent id; planner launch is not supported.');
  }
  return loadProviderPlanningAgentRegistryEntry(provider, plannerAgentId).required_model ?? 'gpt-4.1';
}

export function normalizePlanningAgentReasoningEffort(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'none') {
    return undefined;
  }
  return normalized;
}

export function getPlanningAgentReasoningEffort(): string | undefined {
  const provider = getActiveProvider(REPO_ROOT);
  const plannerAgentId = provider.plannerAgentId();
  if (!plannerAgentId) {
    throw new Error('Active provider has no planner agent id; planner launch is not supported.');
  }
  return normalizePlanningAgentReasoningEffort(
    loadProviderPlanningAgentRegistryEntry(provider, plannerAgentId).reasoning_effort,
  );
}

export function getPlanningAgentAllowedRoots(): string[] {
  const provider = getActiveProvider(REPO_ROOT);
  const plannerAgentId = provider.plannerAgentId();
  if (!plannerAgentId) {
    throw new Error('Active provider has no planner agent id; planner launch is not supported.');
  }
  return [...(loadProviderPlanningAgentRegistryEntry(provider, plannerAgentId).allowed_dirs ?? ['.'])];
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

function inheritedPlannerEnv(controlledEnvKeys: readonly string[], skillDirsEnvKey: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of controlledEnvKeys) {
    delete env[key];
  }
  delete env[skillDirsEnvKey];
  return env;
}

function sanitizedAdditionalPlannerEnv(additionalEnv: NodeJS.ProcessEnv | undefined, skillDirsEnvKey: string): NodeJS.ProcessEnv | undefined {
  if (!additionalEnv) {
    return undefined;
  }
  const sanitized = { ...additionalEnv };
  delete sanitized[skillDirsEnvKey];
  return sanitized;
}

export function buildPlannerCliInvocation(
  options: BuildPlannerCliInvocationOptions,
): PlannerCliInvocation {
  const provider = getActiveProvider(REPO_ROOT);
  const plannerAgentId = provider.plannerAgentId();
  if (!plannerAgentId) {
    throw new Error('Active provider has no planner agent id; planner launch is not supported.');
  }
  const allowedRoots = dedupe(options.allowedRoots ?? getPlanningAgentAllowedRoots());
  const contextPackBoundaryEnforced =
    options.contextPackBoundaryEnforced ?? allowedRoots.length > 0;
  const model = loadProviderPlanningAgentRegistryEntry(provider, plannerAgentId).required_model ?? 'gpt-4.1';
  const reasoningEffort = normalizePlanningAgentReasoningEffort(
    options.reasoningEffort ?? loadProviderPlanningAgentRegistryEntry(provider, plannerAgentId).reasoning_effort,
  );
  const resumeSessionId = options.resumeSessionId ?? null;
  const plannerSessionId = options.plannerSessionId ?? null;
  const promptMode = options.promptMode ?? 'one-shot';
  const buildLaunchSpec = provider.buildPlannerLaunchSpec;

  if (!buildLaunchSpec) {
    throw new Error(`Active provider "${provider.id}" does not support planner CLI sessions.`);
  }
  const skillDirsEnvKey = provider.skillDirsEnvKey();

  const plannerLaunchOptions = {
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    resumeSessionId,
    plannerSessionId,
    prompt: options.prompt,
    promptMode,
    allowedRoots,
    contextPackBoundaryEnforced,
    workingDirectory: options.workingDirectory ?? REPO_ROOT,
    focusEnv: options.focusEnv,
    plannerPersonalityId: options.plannerPersonalityId,
    launchExtensions: options.launchExtensions,
  };
  const launchSpec = buildLaunchSpec(plannerLaunchOptions);
  const additionalEnv = sanitizedAdditionalPlannerEnv(options.additionalEnv, skillDirsEnvKey);

  if (!launchSpec) {
    throw new Error(`Active provider "${provider.id}" does not support planner CLI sessions.`);
  }

  return {
    command: provider.resolveCommand(),
    args: launchSpec.args,
    cwd: launchSpec.launchCwd,
    env: {
      ...inheritedPlannerEnv(provider.controlledEnvKeys(), skillDirsEnvKey),
      RUN_ROLE_AGENT_ACTIVE_MODEL: model,
      ...(plannerSessionId ? { PLANNER_SESSION_ID: plannerSessionId } : {}),
      ...launchSpec.env,
      ...additionalEnv,
    },
    agentId: launchSpec.agentId,
    model,
    reasoningEffort,
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
