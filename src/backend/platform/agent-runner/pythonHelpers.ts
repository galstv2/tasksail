import { runPython, resolvePaths, safeJsonParse } from '../core/index.js';
import type { AgentId, PythonResult } from '../core/index.js';
import path from 'node:path';

export interface ExternalMcpLaunchContext {
  status: string;
  reason: string;
  injectionEnabled: boolean;
  envExports: Record<string, string>;
  configFilePath?: string;
  selectedServerIds: string[];
  excludedServerIds: string[];
}

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

function parseExternalMcpLaunchContext(stdout: string): ExternalMcpLaunchContext {
  const parsed = safeJsonParse<Partial<ExternalMcpLaunchContext>>(
    stdout,
    'prepare-external-mcp-launch-context output',
  );

  if (typeof parsed.status !== 'string') {
    throw new Error('Invalid external MCP launch context output: status must be a string.');
  }
  if (typeof parsed.reason !== 'string') {
    throw new Error('Invalid external MCP launch context output: reason must be a string.');
  }
  if (typeof parsed.injectionEnabled !== 'boolean') {
    throw new Error('Invalid external MCP launch context output: injectionEnabled must be a boolean.');
  }
  if (!isStringRecord(parsed.envExports)) {
    throw new Error('Invalid external MCP launch context output: envExports must be a string map.');
  }
  if (
    parsed.configFilePath !== undefined &&
    parsed.configFilePath !== null &&
    typeof parsed.configFilePath !== 'string'
  ) {
    throw new Error('Invalid external MCP launch context output: configFilePath must be a string when provided.');
  }
  if (!isStringArray(parsed.selectedServerIds)) {
    throw new Error('Invalid external MCP launch context output: selectedServerIds must be a string array.');
  }
  if (!isStringArray(parsed.excludedServerIds)) {
    throw new Error('Invalid external MCP launch context output: excludedServerIds must be a string array.');
  }

  return {
    status: parsed.status,
    reason: parsed.reason,
    injectionEnabled: parsed.injectionEnabled,
    envExports: parsed.envExports,
    configFilePath: parsed.configFilePath ?? undefined,
    selectedServerIds: parsed.selectedServerIds,
    excludedServerIds: parsed.excludedServerIds,
  };
}

/**
 * Generate AgentWorkSpace/handoffs/code-changes.diff for QA review.
 */
export async function captureCodeDiff(options: {
  outputPath: string;
  contextPackDir?: string;
  repoRoot?: string;
  abortSignal?: AbortSignal;
}): Promise<PythonResult> {
  const paths = resolvePaths(options.repoRoot);
  const helperPath = helperPathForRepo(paths.repoRoot);
  const args = [
    'capture-code-diff',
    options.outputPath,
    '--repo-root',
    paths.repoRoot,
  ];

  if (options.contextPackDir) {
    args.push('--context-pack-dir', options.contextPackDir);
  }

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
  env?: Record<string, string>;
  abortSignal?: AbortSignal;
}): Promise<ExternalMcpLaunchContext> {
  const paths = resolvePaths(options.repoRoot);
  const helperPath = helperPathForRepo(paths.repoRoot);
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
      env: options.env,
      abortSignal: options.abortSignal,
    },
  );

  return parseExternalMcpLaunchContext(result.stdout);
}
