/**
 * §6.3B — per-task compose teardown.
 *
 * Runs `<backend> compose -f <composeFile> down` with
 * `COMPOSE_PROJECT_NAME=tasksail-<slug>` so compose scopes teardown to the
 * task's project. F4 project-name isolation means networks and named volumes
 * are auto-scoped under that project, so `down` at the per-task project level
 * reaps containers, networks, and per-project named volumes without touching
 * any other task's resources.
 *
 * Idempotent: exit codes and stderr are logged but not propagated. Callers
 * (teardown ordering in `finalizeTaskWorktrees`) MUST treat this as
 * best-effort — a missing compose binary or already-stopped project is NOT
 * an error worth escalating.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { resolveContainerRuntime } from '../platform-config/resolve.js';
import { resolveDefaultComposeFile } from './types.js';
import { composeProjectName } from './containerNaming.js';

export async function composeDownTask(
  repoRoot: string,
  taskId: string,
): Promise<void> {
  const backend = await resolveContainerRuntime(repoRoot);
  const composeFile = path.resolve(repoRoot, resolveDefaultComposeFile(backend));
  const projectName = composeProjectName(taskId);

  await new Promise<void>((resolve) => {
    const child = spawn(
      backend,
      ['compose', '-f', composeFile, 'down'],
      {
        env: { ...process.env, COMPOSE_PROJECT_NAME: projectName },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    child.stdin.end();

    let stderr = '';
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });

    child.on('error', (err: Error) => {
      process.stderr.write(
        `[composeDownTask] project=${projectName} spawn-error=${err.message}\n`,
      );
      resolve();
    });
    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        process.stderr.write(
          `[composeDownTask] project=${projectName} exit=${code} stderr=${stderr.trim()}\n`,
        );
      }
      resolve();
    });
  });
}
