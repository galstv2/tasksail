import path from 'node:path';
import { existsSync } from 'node:fs';
import { createRuntimeFromConfig } from './runtime.js';
import { resolveDefaultComposeFile } from './types.js';
import { listAllocations } from './portAllocator.js';
import {
  COMPOSE_PROJECT_NAME_PREFIX,
  REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX,
  composeProjectName,
} from './containerNaming.js';
import type { TaskContextPackBinding } from '../queue/taskJson.js';

export interface BootstrapTaskMcpOptions {
  repoRoot: string;
  taskId: string;
  contextPackBinding?: TaskContextPackBinding;
  build?: boolean;
}

export interface BootstrapTaskMcpResult {
  status: 'started' | 'skipped';
  reason?: 'compose-file-missing';
  port?: number;
  composeProjectName?: string;
}

/**
 * Start the per-task repo-context MCP compose project for an activated task.
 *
 * The port allocation is authoritative and must already exist. In bare test
 * repos that do not contain the TaskSail compose file, this returns `skipped`
 * rather than failing unrelated queue-unit tests; real TaskSail checkouts have
 * the compose file and therefore fail closed on bootstrap errors.
 */
export async function bootstrapTaskMcp(
  options: BootstrapTaskMcpOptions,
): Promise<BootstrapTaskMcpResult> {
  const dockerComposeFile = path.resolve(
    options.repoRoot,
    resolveDefaultComposeFile('docker'),
  );
  const podmanComposeFile = path.resolve(
    options.repoRoot,
    resolveDefaultComposeFile('podman'),
  );
  if (!existsSync(dockerComposeFile) && !existsSync(podmanComposeFile)) {
    return { status: 'skipped', reason: 'compose-file-missing' };
  }

  const runtime = await createRuntimeFromConfig(options.repoRoot);
  const composeFile = path.resolve(
    options.repoRoot,
    resolveDefaultComposeFile(runtime.backend),
  );

  if (!existsSync(composeFile)) {
    return { status: 'skipped', reason: 'compose-file-missing' };
  }

  const allocation = (await listAllocations(options.repoRoot)).get(options.taskId);
  if (!allocation) {
    throw new Error(`mcp-port-missing-for-task: ${options.taskId}`);
  }

  const projectName = allocation.composeProjectName || composeProjectName(options.taskId);
  const slug = projectName.startsWith(COMPOSE_PROJECT_NAME_PREFIX)
    ? projectName.slice(COMPOSE_PROJECT_NAME_PREFIX.length)
    : projectName;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    COMPOSE_PROJECT_NAME: projectName,
    REPO_CONTEXT_MCP_CONTAINER_NAME: `${REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX}${slug}`,
    REPO_CONTEXT_MCP_PORT: String(allocation.port),
    TASKSAIL_TASK_ID: options.taskId,
    // The server listens on the container's fixed internal port; the allocated
    // value above is the host binding consumed by agents and health checks.
    REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
    ...contextPackEnv(options.repoRoot, options.contextPackBinding),
  };

  await runtime.bootstrap({
    repoRoot: options.repoRoot,
    composeFile,
    build: options.build,
    env,
  });

  return {
    status: 'started',
    port: allocation.port,
    composeProjectName: projectName,
  };
}

function contextPackEnv(
  repoRoot: string,
  binding: TaskContextPackBinding | undefined,
): NodeJS.ProcessEnv {
  if (!binding) return {};

  const env: NodeJS.ProcessEnv = {};
  if (binding.contextPackPath) {
    env['ACTIVE_CONTEXT_PACK_DIR'] = toContainerWorkspacePath(
      repoRoot,
      path.dirname(binding.contextPackPath),
    );
  }
  if (binding.dataHostDir) {
    env['REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR'] = binding.dataHostDir;
  }
  if (binding.dataContainerDir) {
    env['REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR'] = binding.dataContainerDir;
  }
  return env;
}

function toContainerWorkspacePath(repoRoot: string, hostPath: string): string {
  const rel = path.relative(repoRoot, hostPath);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return path.posix.join('/workspace', rel.split(path.sep).join(path.posix.sep));
  }
  return hostPath;
}
