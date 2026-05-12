import { runPython, resolvePaths, safeJsonParse } from '../core/index.js';
import type { AgentId, PythonResult } from '../core/index.js';
import path from 'node:path';
import { getActiveProvider } from '../cli-provider/index.js';
import type { PreparedMcpLaunch, ResolvedMcpServer } from '../cli-provider/index.js';

export type ExternalMcpLaunchContext = PreparedMcpLaunch;

function helperPathForRepo(repoRoot: string): string {
  return path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'run-role-agent-helper.py',
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isResolvedMcpServerArray(value: unknown): value is ResolvedMcpServer[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((server) => (
    server != null
    && typeof server === 'object'
    && !Array.isArray(server)
    && typeof (server as Record<string, unknown>)['id'] === 'string'
    && ((server as Record<string, unknown>)['transport'] === 'http'
      || (server as Record<string, unknown>)['transport'] === 'sse')
    && typeof (server as Record<string, unknown>)['url'] === 'string'
    && isStringRecord((server as Record<string, unknown>)['headers'])
  ));
}

function containsProviderHomeEnvKey(envExports: Record<string, string>): boolean {
  return Object.keys(envExports).some((key) => key.endsWith('_HOME'));
}

function parseExternalMcpLaunchContext(stdout: string): ExternalMcpLaunchContext {
  const parsed = safeJsonParse<Record<string, unknown>>(
    stdout,
    'prepare-external-mcp-launch-context output',
  );

  const status = parsed['status'];
  const reason = parsed['reason'];
  const injectionEnabled = parsed['injectionEnabled'];
  const envExports = parsed['envExports'];
  const launchDir = parsed['launchDir'];
  const contextFile = parsed['contextFile'];
  const resolvedServers = parsed['resolvedServers'];
  const selectedServerIds = parsed['selectedServerIds'];
  const excludedServerIds = parsed['excludedServerIds'];

  if (typeof status !== 'string') {
    throw new Error('Invalid external MCP launch context output: status must be a string.');
  }
  if (typeof reason !== 'string') {
    throw new Error('Invalid external MCP launch context output: reason must be a string.');
  }
  if (typeof injectionEnabled !== 'boolean') {
    throw new Error('Invalid external MCP launch context output: injectionEnabled must be a boolean.');
  }
  if (!isStringRecord(envExports)) {
    throw new Error('Invalid external MCP launch context output: envExports must be a string map.');
  }
  if (containsProviderHomeEnvKey(envExports)) {
    throw new Error('Invalid external MCP launch context output: envExports must not contain provider-specific home variables.');
  }
  // JSON cannot transmit `undefined`; the Python helper emits `null` for
  // optional fields that are not applicable (e.g. when no external servers
  // are selected). Accept both null and undefined as "absent."
  if (launchDir != null && typeof launchDir !== 'string') {
    throw new Error('Invalid external MCP launch context output: launchDir must be a string when present.');
  }
  if (contextFile != null && typeof contextFile !== 'string') {
    throw new Error('Invalid external MCP launch context output: contextFile must be a string when present.');
  }
  if (resolvedServers != null && !isResolvedMcpServerArray(resolvedServers)) {
    throw new Error('Invalid external MCP launch context output: resolvedServers must be an MCP server array.');
  }
  if (injectionEnabled && (typeof launchDir !== 'string' || !isResolvedMcpServerArray(resolvedServers))) {
    throw new Error('Invalid external MCP launch context output: launchDir and resolvedServers are required when injectionEnabled is true.');
  }
  if (!isStringArray(selectedServerIds)) {
    throw new Error('Invalid external MCP launch context output: selectedServerIds must be a string array.');
  }
  if (!isStringArray(excludedServerIds)) {
    throw new Error('Invalid external MCP launch context output: excludedServerIds must be a string array.');
  }

  return {
    status: status as ExternalMcpLaunchContext['status'],
    reason,
    injectionEnabled,
    envExports,
    launchDir: typeof launchDir === 'string' ? launchDir : undefined,
    contextFile: typeof contextFile === 'string' ? contextFile : undefined,
    resolvedServers: isResolvedMcpServerArray(resolvedServers) ? resolvedServers : [],
    selectedServerIds,
    excludedServerIds,
  };
}

/**
 * Generate the per-task handoffs/code-changes.diff for QA review.
 *
 * Diff scope is the set of per-task worktrees recorded in
 * AgentWorkSpace/tasks/<taskId>/.task.json — never the platform
 * workspace file or the operator's source repo working tree.
 */
export async function captureCodeDiff(options: {
  outputPath: string;
  repoRoot?: string;
  taskId: string;
  abortSignal?: AbortSignal;
}): Promise<PythonResult> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const helperPath = helperPathForRepo(paths.repoRoot);
  const args = [
    'capture-code-diff',
    options.outputPath,
    '--repo-root',
    paths.repoRoot,
    '--task-id',
    options.taskId,
  ];

  return runPython(
    helperPath,
    args,
    {
      cwd: paths.repoRoot,
      abortSignal: options.abortSignal,
    },
  );
}

/**
 * Prepare per-launch external MCP context for an agent subprocess.
 */
export async function prepareExternalMcpLaunchContext(options: {
  agentId: AgentId;
  repoRoot?: string;
  taskId: string;
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext> {
  const paths = resolvePaths({ repoRoot: options.repoRoot, taskId: options.taskId });
  const helperPath = helperPathForRepo(paths.repoRoot);
  const provider = getActiveProvider(paths.repoRoot);
  const providerEnv = {
    TASKSAIL_CLI_HOME_DIR_NAME: provider.homeDirName(),
    TASKSAIL_AGENT_REGISTRY_PATH: path.join(paths.repoRoot, provider.agentConfigPaths().registry),
  };
  const result = await runPython(
    helperPath,
    [
      'prepare-external-mcp-launch-context',
      options.agentId,
      '--repo-root',
      paths.repoRoot,
    ],
    {
      cwd: paths.repoRoot,
      env: {
        ...providerEnv,
        ...options.env,
      },
      abortSignal: options.abortSignal,
    },
  );

  return parseExternalMcpLaunchContext(result.stdout);
}
