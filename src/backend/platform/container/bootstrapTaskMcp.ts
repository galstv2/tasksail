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
import { toEngineHostPath } from '../core/platform.js';
import type { ContainerEngineHost } from '../core/index.js';
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
    ...contextPackEnv(options.repoRoot, options.contextPackBinding, {
      engineHost: runtime.engineHost,
      wslDistro: runtime.wslDistro,
    }),
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

export interface ResolvedContextPackMount {
  hostMountSource?: string;
  containerPath: string;
}

export interface EngineHostTranslationOptions {
  engineHost: ContainerEngineHost;
  wslDistro: string | null;
}

export function resolveContextPackMount(
  repoRoot: string,
  binding: TaskContextPackBinding,
  engineOptions: EngineHostTranslationOptions,
): ResolvedContextPackMount {
  if (!binding.contextPackPath) {
    return { containerPath: '/mnt/context-pack' };
  }
  const packDirHost = path.resolve(path.dirname(binding.contextPackPath));
  const repoRootAbs = path.resolve(repoRoot);
  const rel = path.relative(repoRootAbs, packDirHost);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    return {
      containerPath: path.posix.join(
        '/workspace',
        rel.split(path.sep).join('/'),
      ),
    };
  }
  return {
    hostMountSource: toEngineHostPath(packDirHost, engineOptions),
    containerPath: '/mnt/context-pack',
  };
}

export function contextPackEnv(
  repoRoot: string,
  binding: TaskContextPackBinding | undefined,
  engineOptions: EngineHostTranslationOptions,
): NodeJS.ProcessEnv {
  if (!binding) return {};
  const env: NodeJS.ProcessEnv = {};
  const mount = resolveContextPackMount(repoRoot, binding, engineOptions);
  env['ACTIVE_CONTEXT_PACK_DIR'] = mount.containerPath;
  if (mount.hostMountSource) {
    env['ACTIVE_CONTEXT_PACK_HOST_DIR'] = mount.hostMountSource;
  }
  if (binding.dataHostDir) {
    env['REPO_CONTEXT_MCP_CONTEXT_DATA_HOST_DIR'] = toEngineHostPath(
      path.resolve(binding.dataHostDir),
      engineOptions,
    );
  }
  if (binding.dataContainerDir) {
    if (!binding.dataContainerDir.startsWith('/')) {
      throw new Error(
        `dataContainerDir must be an absolute POSIX path: ${binding.dataContainerDir}`,
      );
    }
    env['REPO_CONTEXT_MCP_CONTEXT_DATA_CONTAINER_DIR'] = binding.dataContainerDir;
  }
  return env;
}
