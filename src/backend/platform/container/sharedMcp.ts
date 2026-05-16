import path from 'node:path';
import { rm, stat } from 'node:fs/promises';

import { isRecord } from '../core/guards.js';
import { createLogger } from '../core/index.js';
import { readTextFile, safeJsonParse, writeTextFileAtomic } from '../core/io.js';
import { isPathWithinBoundary } from '../core/paths.js';
import { toContainerPath } from '../core/platform.js';
import { getPlatformConfig } from '../platform-config/get.js';
import type { PlatformConfig } from '../platform-config/types.js';
import { checkServiceHealth } from './healthcheck.js';
import { createRuntimeFromConfig } from './runtime.js';
import { resolveDefaultComposeFile } from './types.js';
import { isDirectMcpHealthy } from './directRuntimeProcess.js';

const log = createLogger('platform/container/sharedMcp');

const SHARED_MCP_COMPOSE_OVERRIDE_PATH = '.platform-state/runtime/shared-mcp-compose.override.yml';
const SHARED_MCP_HEALTH_SPEC = 'repo-context-mcp';
const LEGACY_PORT_ALLOCATIONS_PATH = '.platform-state/runtime/port-allocations.json';
const SCRUBBED_SHARED_MCP_ENV_KEYS = [
  'COMPOSE_PROJECT_NAME',
  'REPO_CONTEXT_MCP_CONTAINER_NAME',
  'REPO_CONTEXT_MCP_PORT',
  'REPO_CONTEXT_MCP_CONTAINER_PORT',
  'TASKSAIL_TASK_ID',
  'ACTIVE_CONTEXT_PACK_DIR',
  'ACTIVE_CONTEXT_PACK_HOST_DIR',
] as const;
const SCRUBBED_SHARED_MCP_ENV_KEY_SET = new Set<string>(SCRUBBED_SHARED_MCP_ENV_KEYS);
const legacyPortAllocationSweepByRepoRoot = new Map<string, Promise<void>>();
const sharedMcpBootstrapInFlight = new Map<string, Promise<void>>();

export class ContextPackNotMountedError extends Error {
  readonly code = 'context-pack-not-mounted';

  constructor(hostContextPackDir: string) {
    super(
      `context-pack-not-mounted: context pack path is not under the repo root or a configured external mount root: ${hostContextPackDir}`,
    );
    this.name = 'ContextPackNotMountedError';
  }
}

export async function getSharedMcpPort(repoRoot: string): Promise<number> {
  const config = await getPlatformConfig(repoRoot);
  return config.mcp_port;
}

export async function getSharedMcpUrl(repoRoot: string): Promise<string> {
  const port = await getSharedMcpPort(repoRoot);
  return `http://localhost:${port}/sse`;
}

export async function getSharedMcpHealthUrl(repoRoot: string): Promise<string> {
  const port = await getSharedMcpPort(repoRoot);
  return `http://localhost:${port}/health`;
}

export async function ensureSharedMcpRunning(repoRoot: string): Promise<void> {
  await sweepLegacyPortAllocationsOnce(repoRoot);

  const config = await getPlatformConfig(repoRoot);
  const healthUrl = `http://localhost:${config.mcp_port}/health`;
  if (await isAlreadyHealthy(config, healthUrl, repoRoot)) {
    return;
  }

  const resolvedRepoRoot = path.resolve(repoRoot);
  const existing = sharedMcpBootstrapInFlight.get(resolvedRepoRoot);
  if (existing) {
    return existing;
  }

  const bootstrap = runSharedMcpBootstrap(repoRoot, config, healthUrl)
    .finally(() => {
      sharedMcpBootstrapInFlight.delete(resolvedRepoRoot);
    });
  sharedMcpBootstrapInFlight.set(resolvedRepoRoot, bootstrap);
  return bootstrap;
}

async function isAlreadyHealthy(
  config: PlatformConfig,
  healthUrl: string,
  repoRoot: string,
): Promise<boolean> {
  const initialHealth = await checkServiceHealth({
    name: SHARED_MCP_HEALTH_SPEC,
    url: healthUrl,
    maxRetries: 1,
    retryIntervalMs: 0,
  });
  return (
    initialHealth.healthy
    && (config.container_runtime !== 'direct' || await isDirectMcpHealthy(repoRoot, config.mcp_port))
  );
}

async function runSharedMcpBootstrap(
  repoRoot: string,
  config: PlatformConfig,
  healthUrl: string,
): Promise<void> {
  const runtime = await createRuntimeFromConfig(repoRoot);
  const env = createSharedMcpBootstrapEnv(config.mcp_port);
  if (runtime.requiresComposeFile) {
    const composeFile = resolveDefaultComposeFile(runtime.backend);
    if (composeFile === undefined) {
      throw new Error(
        `requiresComposeFile=true but no default compose file is registered for backend "${runtime.backend}". This is an internal invariant violation.`,
      );
    }
    const overrideFile = await generateSharedMcpComposeOverride(
      repoRoot,
      config.repo_context_mcp_external_mount_roots,
    );
    await runtime.bootstrap({
      repoRoot,
      composeFiles: [
        path.resolve(repoRoot, composeFile),
        overrideFile,
      ],
      env,
    });
  } else {
    await runtime.bootstrap({ repoRoot, env });
  }

  const bootstrapHealth = await checkServiceHealth({
    name: SHARED_MCP_HEALTH_SPEC,
    url: healthUrl,
    maxRetries: 10,
    retryIntervalMs: 2000,
  });
  if (!bootstrapHealth.healthy) {
    throw new Error(
      `Shared repo-context-mcp failed health check at ${healthUrl}: ${bootstrapHealth.error ?? 'not healthy'}`,
    );
  }
}

export function sweepLegacyPortAllocationsOnce(repoRoot: string): Promise<void> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const existingSweep = legacyPortAllocationSweepByRepoRoot.get(resolvedRepoRoot);
  if (existingSweep) return existingSweep;

  const sweep = runLegacyPortAllocationSweep(resolvedRepoRoot).catch((err: unknown) => {
    logLegacySweepFailure(
      `unexpected startup sweep failure for ${legacyPortAllocationsPath(resolvedRepoRoot)}`,
      err,
    );
  });
  legacyPortAllocationSweepByRepoRoot.set(resolvedRepoRoot, sweep);
  return sweep;
}

export async function runtimeRequiresContainerPaths(repoRoot: string): Promise<boolean> {
  const runtime = await createRuntimeFromConfig(repoRoot);
  return runtime.requiresComposeFile;
}

export async function generateSharedMcpComposeOverride(
  repoRoot: string,
  externalRoots: string[],
): Promise<string> {
  const overridePath = path.join(repoRoot, SHARED_MCP_COMPOSE_OVERRIDE_PATH);
  await validateExternalMountRoots(externalRoots);
  await writeTextFileAtomic(overridePath, renderSharedMcpComposeOverride(externalRoots));
  return overridePath;
}

export function createSharedMcpBootstrapEnv(
  mcpPort: number,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!SCRUBBED_SHARED_MCP_ENV_KEY_SET.has(key)) {
      env[key] = value;
    }
  }
  env['REPO_CONTEXT_MCP_PORT'] = String(mcpPort);
  env['REPO_CONTEXT_MCP_CONTAINER_PORT'] = '8811';
  return env;
}

export function resolveContextPackContainerPath(
  repoRoot: string,
  hostContextPackDir: string,
  externalRoots: string[],
): string {
  if (isPathWithinBoundary(repoRoot, hostContextPackDir)) {
    return toContainerPath(hostContextPackDir, repoRoot, '/workspace');
  }

  for (const [index, externalRoot] of externalRoots.entries()) {
    if (!path.isAbsolute(externalRoot)) {
      throw new Error(
        `repo_context_mcp_external_mount_roots must contain absolute host paths, got ${JSON.stringify(externalRoot)}.`,
      );
    }

    if (isPathWithinBoundary(externalRoot, hostContextPackDir)) {
      return toContainerPath(hostContextPackDir, externalRoot, `/context-pack-roots/${index}`);
    }
  }

  throw new ContextPackNotMountedError(hostContextPackDir);
}

async function validateExternalMountRoots(externalRoots: string[]): Promise<void> {
  for (const externalRoot of externalRoots) {
    if (!path.isAbsolute(externalRoot)) {
      throw new Error(
        `repo_context_mcp_external_mount_roots must contain absolute host paths, got ${JSON.stringify(externalRoot)}.`,
      );
    }
    let rootStat;
    try {
      rootStat = await stat(externalRoot);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `repo_context_mcp_external_mount_roots entry is not accessible: ${externalRoot} (${message})`,
      );
    }
    if (!rootStat.isDirectory()) {
      throw new Error(
        `repo_context_mcp_external_mount_roots entry is not a directory: ${externalRoot}`,
      );
    }
  }
}

function renderSharedMcpComposeOverride(externalRoots: string[]): string {
  const lines = [
    '# Generated by TaskSail. Do not edit.',
    'services:',
    '  repo-context-mcp:',
  ];

  if (externalRoots.length === 0) {
    lines.push('    volumes: []');
    return `${lines.join('\n')}\n`;
  }

  lines.push('    volumes:');
  for (const [index, externalRoot] of externalRoots.entries()) {
    lines.push(
      '      - type: bind',
      `        source: ${JSON.stringify(path.resolve(externalRoot))}`,
      `        target: /context-pack-roots/${index}`,
      '        read_only: true',
    );
  }

  return `${lines.join('\n')}\n`;
}

async function runLegacyPortAllocationSweep(repoRoot: string): Promise<void> {
  const allocationsPath = legacyPortAllocationsPath(repoRoot);
  let raw: string | undefined;
  try {
    raw = await readTextFile(allocationsPath);
    if (raw === undefined) return; // ENOENT — nothing to sweep.
  } catch (err: unknown) {
    // Non-ENOENT read failure: still fall through to delete the file so a
    // corrupt allocations record cannot poison subsequent startups.
    logLegacySweepFailure(`failed to read ${allocationsPath}`, err);
  }

  try {
    if (raw !== undefined) {
      const projectNames = legacyComposeProjectNames(raw, allocationsPath);
      if (projectNames.length > 0) {
        await composeDownLegacyProjects(repoRoot, projectNames, allocationsPath);
      }
    }
  } finally {
    await rm(allocationsPath, { force: true }).catch((err: unknown) => {
      logLegacySweepFailure(`failed to delete ${allocationsPath}`, err);
    });
  }
}

function legacyComposeProjectNames(raw: string, allocationsPath: string): string[] {
  let parsed: unknown;
  try {
    parsed = safeJsonParse<unknown>(raw, allocationsPath);
  } catch (err: unknown) {
    logLegacySweepFailure(`failed to parse ${allocationsPath}`, err);
    return [];
  }

  if (!isRecord(parsed)) {
    return [];
  }

  const projectNames = new Set<string>();
  for (const record of Object.values(parsed)) {
    if (!isRecord(record)) continue;
    const composeProjectName = record['composeProjectName'];
    if (typeof composeProjectName === 'string' && composeProjectName.trim() !== '') {
      projectNames.add(composeProjectName);
    }
  }
  return [...projectNames];
}

async function composeDownLegacyProjects(
  repoRoot: string,
  projectNames: string[],
  allocationsPath: string,
): Promise<void> {
  let runtime;
  try {
    runtime = await createRuntimeFromConfig(repoRoot);
  } catch (err: unknown) {
    logLegacySweepFailure(
      `failed to create container runtime for ${allocationsPath}; ${projectNames.length} legacy compose project(s) not swept`,
      err,
    );
    return;
  }

  if (!runtime.requiresComposeFile) {
    return;
  }
  const composeFileRel = resolveDefaultComposeFile(runtime.backend);
  if (composeFileRel === undefined) {
    logLegacySweepFailure(
      `no default compose file for ${runtime.backend}; ${projectNames.length} legacy compose project(s) not swept`,
      new Error('missing compose file mapping'),
    );
    return;
  }
  const composeFile = path.resolve(repoRoot, composeFileRel);
  for (const projectName of projectNames) {
    try {
      await runtime.composeDown({
        composeFile,
        projectName,
      });
    } catch (err: unknown) {
      logLegacySweepFailure(
        `failed to compose down legacy MCP project ${projectName} from ${allocationsPath}`,
        err,
      );
    }
  }
}

function legacyPortAllocationsPath(repoRoot: string): string {
  return path.join(repoRoot, LEGACY_PORT_ALLOCATIONS_PATH);
}

function logLegacySweepFailure(message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  log.warn('legacy_port_allocation_sweep.failed', { message, error: detail });
}
