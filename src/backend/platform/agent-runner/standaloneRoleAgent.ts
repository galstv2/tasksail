import path from 'node:path';

import { createLogger, type AgentId } from '../core/index.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { ResolvedMcpServer } from '../cli-provider/index.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { resolveContextPackContainerPath, runtimeRequiresContainerPaths } from '../container/sharedMcp.js';
import { resolveAgentProfile, loadAgentRegistry } from './metadata.js';
import { resolveAutonomyProfile, buildAgentArgs } from './autonomy.js';
import { buildAgentEnvironment, buildAutonomyEnvironment } from './environment.js';
import {
  runAgentSession,
  mergeExternalMcpLaunchEnvironment,
  summarizeExternalMcpLaunchContext,
  logExternalMcpLaunchStatus,
  type PreparedAgentMcpLaunchContext,
} from './agentSession.js';
import { agentErrorWithTails } from './recoveryPasses.js';
import { createRoleLaunchId, sha256Hex } from './roleAgent.js';
import { buildReinforcementOverlay } from './reinforcementOverlay.js';
import {
  buildAgentRuntimePathManifest,
  prependRuntimePathManifestToPrompt,
} from './agentRuntimePathManifest.js';
import type { AgentMcpLaunchStatus } from './types.js';

const log = createLogger('platform/agent-runner/standaloneRoleAgent');

export interface StandaloneRoleAgentOptions {
  agentId: AgentId;
  repoRoot: string;
  contextPackDir?: string;
  runtimeDir: string;
  launchPhase: string;
  promptOverride: string;
  extraEnv?: Record<string, string>;
  extraAllowedDirs?: string[];
  wallClockBudget?: number;
  idleTimeout?: number;
  abortSignal?: AbortSignal;
}

export interface StandaloneRoleAgentResult {
  exitCode: number;
  agentId: AgentId;
  durationMs: number;
  mcpLaunch?: AgentMcpLaunchStatus;
}

function uniqueAbsoluteDirs(repoRoot: string, dirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(repoRoot, trimmed);
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

export async function runStandaloneRoleAgent(
  options: StandaloneRoleAgentOptions,
): Promise<StandaloneRoleAgentResult> {
  const startTime = Date.now();
  const registry = await loadAgentRegistry(options.repoRoot);
  const profile = resolveAgentProfile(registry, options.agentId);
  const provider = getActiveProvider(options.repoRoot);
  const prompt = options.promptOverride.trim();
  if (!prompt) {
    throw new Error('Standalone role-agent launch requires a non-empty promptOverride.');
  }
  const reinforcementOverlay = await buildReinforcementOverlay({
    agentId: options.agentId,
    contextPackDir: options.contextPackDir,
    repoRoot: options.repoRoot,
  });
  const promptWithOverlay = reinforcementOverlay
    ? `${prompt}\n\n${reinforcementOverlay}`
    : prompt;

  const autonomyIntent = resolveAutonomyProfile(
    profile,
    options.contextPackDir,
    options.repoRoot,
  );
  autonomyIntent.allowedDirs = uniqueAbsoluteDirs(options.repoRoot, [
    ...autonomyIntent.allowedDirs,
    ...(options.extraAllowedDirs ?? []),
  ]);

  const launchContext = {
    repoRoot: options.repoRoot,
    requestedCwd: options.repoRoot,
  };
  const argsResult = buildAgentArgs(options.repoRoot, profile, autonomyIntent, { launchContext });
  const cliArgs = [...argsResult.args];

  const wallClockTimeoutS = options.wallClockBudget ?? profile.wallClockTimeoutS;
  const idleTimeoutS = options.idleTimeout ?? profile.idleTimeoutS;

  let sharedMcp: { url: string; port: number } | undefined;
  let containerContextPackDir: string | undefined;
  let internalMcpServer: ResolvedMcpServer | undefined;
  if (options.contextPackDir) {
    const platformConfig = await getPlatformConfig(options.repoRoot);
    const sharedMcpPort = platformConfig.mcp_port;
    const sharedMcpUrl = `http://localhost:${sharedMcpPort}/sse`;
    sharedMcp = { url: sharedMcpUrl, port: sharedMcpPort };
    containerContextPackDir = (await runtimeRequiresContainerPaths(options.repoRoot))
      ? resolveContextPackContainerPath(
        options.repoRoot,
        options.contextPackDir,
        platformConfig.repo_context_mcp_external_mount_roots,
      )
      : options.contextPackDir;
    internalMcpServer = {
      id: 'repo-context-mcp',
      transport: 'sse',
      url: sharedMcpUrl,
      headers: {
        'X-TaskSail-Task-Id': '',
        'X-TaskSail-Context-Pack-Dir': containerContextPackDir,
      },
    };
  }

  const agentEnv = buildAgentEnvironment(
    profile,
    containerContextPackDir ?? options.contextPackDir,
    options.repoRoot,
    {
      skipHandoffEnvVars: true,
      wallClockTimeoutS,
      ...(sharedMcp ? { mcp: sharedMcp } : {}),
    },
  );
  Object.assign(agentEnv, options.extraEnv ?? {});

  const externalMcpLaunchContext = await mergeExternalMcpLaunchEnvironment({
    agentId: options.agentId,
    repoRoot: options.repoRoot,
    taskId: '',
    agentEnv,
    internalMcpServer,
    abortSignal: options.abortSignal,
  });
  let mcpConfigArgsToAppend: string[] = [];
  if (externalMcpLaunchContext?.injectionEnabled) {
    const configFilePath = (externalMcpLaunchContext as PreparedAgentMcpLaunchContext).configFilePath;
    if (configFilePath) {
      mcpConfigArgsToAppend = provider.mcpConfigArgs(configFilePath);
    } else {
      log.warn('external_mcp.config_path.missing', { agentId: options.agentId });
    }
  }
  const mcpLaunch = summarizeExternalMcpLaunchContext(externalMcpLaunchContext);
  logExternalMcpLaunchStatus(options.agentId, mcpLaunch);
  Object.assign(
    agentEnv,
    buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      options.repoRoot,
      options.repoRoot,
      undefined,
      options.contextPackDir,
      externalMcpLaunchContext,
    ),
  );

  const manifest = buildAgentRuntimePathManifest({
    agentId: options.agentId,
    launchPhase: options.launchPhase,
    agentCwd: options.repoRoot,
    env: agentEnv,
    providerEnvVars: provider.runtimeManifestEnvVars(),
  });
  const promptResult = provider.materializePrompt({
    prompt: prependRuntimePathManifestToPrompt({ prompt: promptWithOverlay, manifest }),
    promptPath: null,
    promptSource: 'override',
    profile,
    launchContext,
    includeGlobalInstructions: profile.autonomyProfile !== 'repo-executor',
  });
  cliArgs.push('-p', promptResult.effectivePrompt);
  cliArgs.push(...mcpConfigArgsToAppend);

  const launchId = createRoleLaunchId();
  const promptAudit = {
    promptPath: null,
    promptSource: 'override' as const,
    inlineAgentContext: promptResult.inlineAgentContext,
    effectivePromptSha256: sha256Hex(promptResult.effectivePrompt),
  };
  const session = await runAgentSession({
    repoRoot: options.repoRoot,
    cliArgs,
    cwd: options.repoRoot,
    env: agentEnv,
    wallClockTimeoutS,
    idleTimeoutS,
    abortSignal: options.abortSignal,
    session: {
      taskRuntime: options.runtimeDir,
      launchId,
      agentId: options.agentId,
      roleName: profile.role,
      displayName: profile.displayName,
      launchPhase: options.launchPhase,
      promptAudit,
    },
  });

  const durationMs = Date.now() - startTime;
  const { runSummary } = session;
  if (runSummary.exitCode !== 0) {
    throw agentErrorWithTails(
      `Standalone agent "${options.agentId}" exited with code ${runSummary.exitCode} (${runSummary.terminationReason}).`,
      runSummary,
    );
  }

  return {
    exitCode: runSummary.exitCode,
    agentId: options.agentId,
    durationMs,
    mcpLaunch,
  };
}
