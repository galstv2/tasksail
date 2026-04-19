import { fork } from 'node:child_process';
import { sep, join, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * F14: Resolves the pipeline child entrypoint path for the current runtime environment.
 * - Dev/tsx: returns `<dir>/<name>.ts`
 * - Production ASAR: returns the .js counterpart from the unpacked resources path.
 *   The entrypoint file MUST be listed in electron-builder's `asarUnpack` glob so it
 *   lands in `resources/app.asar.unpacked/` and is executable by the Node child_process.
 *
 * Exported for unit testing only (F14 ASAR discriminator unit test).
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
  return join(dir, name + '.ts');
}

/**
 * Spawn a pipeline child process for a given task.
 *
 * F13: Returns stdout/stderr streams so the supervisor (§5.2) can readline-split
 * and wrap each line in the { type, taskId, line, ts } envelope before forwarding.
 * Callers that do not consume the streams MUST still drain them to prevent the pipe
 * buffer from filling and stalling the child process.
 *
 * F14: The child entrypoint path is resolved at runtime via resolveChildEntryPath to
 * handle both dev (tsx .ts) and production ASAR-packaged (.js) environments.
 */
export async function spawnPipelineForTask(options: {
  taskId: string;
  repoRoot: string;
}): Promise<{ pid: number; stdout: Readable; stderr: Readable; exit: Promise<number> }> {
  // F14: resolve entrypoint path at runtime to handle ASAR-packaged production builds.
  // In production (app.isPackaged), __dirname points inside the ASAR archive where .ts
  // files do not exist; use the transpiled .js path under resources/app.asar.unpacked/.
  // In dev/test (tsx), __dirname resolves the .ts file directly.
  const entryFile = resolveChildEntryPath(__dirname, 'pipelineChildEntry');
  const child = fork(
    entryFile,
    ['--task-id', options.taskId, '--repo-root', options.repoRoot],
    {
      env: {
        ...process.env,
        TASKSAIL_TASK_ID: options.taskId,
        RUN_ROLE_AGENT_ALLOW_INTERNAL_BYPASS: 'true',
        RUN_ROLE_AGENT_ORCHESTRATOR_ID: 'pipeline-sequencer',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  // F13: surface stdout/stderr streams so the supervisor (§5.2) can readline-split and
  // wrap each line in the { type, taskId, line, ts } envelope before forwarding.
  // Callers that do not consume the streams MUST still drain them to prevent the pipe
  // buffer from filling and stalling the child process.
  return {
    pid: child.pid!,
    stdout: child.stdout!,
    stderr: child.stderr!,
    exit: new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1))),
  };
}
