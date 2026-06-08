import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { sep, join, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { buildTaskLaunchBaseEnv } from './launchEnv.js';
import { getActiveProvider } from '../cli-provider/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

/**
 * Resolve the pipeline child entrypoint path for the current runtime environment.
 * - Dev/tsx: returns `<dir>/<name>.ts`
 * - Production ASAR: returns the .js counterpart from the unpacked resources path.
 *   The entrypoint file MUST be listed in electron-builder's `asarUnpack` glob so it
 *   lands in `resources/app.asar.unpacked/` and is executable by the Node child_process.
 *
 * Exported for unit testing the ASAR discriminator.
 */
export function resolveChildEntryPath(dir: string, name: string): string {
  // app.isPackaged is set by Electron in production; absent in CLI/test contexts.
  const isPackaged =
    typeof process !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).isPackaged === true;
  if (isPackaged) {
    // __dirname inside ASAR: replace the .asar segment with .asar.unpacked and use .js
    return dir.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1') + sep + name + '.js';
  }
  const tsEntry = join(dir, name + '.ts');
  if (existsSync(tsEntry)) {
    return tsEntry;
  }
  const jsEntry = join(dir, name + '.js');
  if (existsSync(jsEntry)) {
    return jsEntry;
  }
  return tsEntry;
}

/**
 * Spawn a pipeline child process for a given task.
 *
 * Returns stdout/stderr streams so the supervisor can readline-split
 * and wrap each line in the { type, taskId, line, ts } envelope before forwarding.
 * Callers that do not consume the streams MUST still drain them to prevent the pipe
 * buffer from filling and stalling the child process.
 *
 * The child entrypoint path is resolved at runtime via resolveChildEntryPath to
 * handle both dev (tsx .ts) and production ASAR-packaged (.js) environments.
 */
export async function spawnPipelineForTask(options: {
  taskId: string;
  repoRoot: string;
}): Promise<{ pid: number; stdout: Readable; stderr: Readable; exit: Promise<number> }> {
  // Resolve entrypoint path at runtime to handle ASAR-packaged production builds.
  // In production (app.isPackaged), __dirname points inside the ASAR archive where .ts
  // files do not exist; use the transpiled .js path under resources/app.asar.unpacked/.
  // In dev/test (tsx), __dirname resolves the .ts file directly.
  const entryFile = resolveChildEntryPath(__dirname, 'pipelineChildEntry');
  const execArgv = entryFile.endsWith('.ts')
    ? ['--import', pathToFileURL(require.resolve('tsx')).href]
    : [];
  const child = fork(
    entryFile,
    ['--task-id', options.taskId, '--repo-root', options.repoRoot],
    {
      cwd: options.repoRoot,
      env: {
        ...buildTaskLaunchBaseEnv(
          process.env,
          getActiveProvider(options.repoRoot).controlledEnvKeys(),
        ),
        TASKSAIL_TASK_ID: options.taskId,
        RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS: 'true',
        RUN_ROLE_AGENT_ORCHESTRATOR_ID: 'pipeline-sequencer',
      },
      execArgv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  if (child.pid === undefined) {
    child.once('error', () => undefined);
    throw new Error('Failed to spawn pipeline child: no PID returned by fork().');
  }
  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  // Surface stdout/stderr streams so the supervisor can readline-split and
  // wrap each line in the { type, taskId, line, ts } envelope before forwarding.
  // Callers that do not consume the streams MUST still drain them to prevent the pipe
  // buffer from filling and stalling the child process.
  return {
    pid: child.pid,
    stdout: child.stdout!,
    stderr: child.stderr!,
    exit,
  };
}
