import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { acquireDirLock } from './dirLock.js';

export const REGISTRY_LOCK_DIR_RELATIVE = '.platform-state/task-registry.lock';

const REGISTRY_LOCK_STALE_MS = 30 * 1000;

export async function acquireRegistryLock(
  repoRoot: string,
  options: { maxRetries?: number; backoffMs?: number; timeoutMs?: number } = {},
): Promise<() => Promise<void>> {
  const backoffMs = options.backoffMs ?? 20;
  const maxRetries = options.maxRetries ?? retriesForTimeout(options.timeoutMs, backoffMs);
  const lockDir = path.join(repoRoot, REGISTRY_LOCK_DIR_RELATIVE);
  await mkdir(path.dirname(lockDir), { recursive: true });
  const release = await acquireDirLock(
    lockDir,
    maxRetries,
    backoffMs,
    REGISTRY_LOCK_STALE_MS,
  );
  if (!release) {
    throw new Error('task-registry-lock-timeout: could not acquire task registry lock.');
  }
  return release;
}

function retriesForTimeout(timeoutMs: number | undefined, backoffMs: number): number {
  if (timeoutMs === undefined) {
    return 50;
  }
  return Math.max(1, Math.ceil(timeoutMs / Math.max(1, backoffMs)));
}
