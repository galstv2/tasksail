import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withDirLock } from '../queue/dirLock.js';

function agentExtensionsLockDir(repoRoot: string): string {
  return path.join(repoRoot, '.platform-state', 'agent-extensions', '.lock');
}

/**
 * Run `fn` while holding the agent-extensions lock.
 * Non-reentrant: inner callees must be lock-free.
 * Acquisition retries with exponential backoff (the dirLock default: ~51s budget)
 * so concurrent acquirers wait rather than fail; it throws a content-safe busy
 * error only after the retry budget is exhausted.
 */
export async function withAgentExtensionsLock<T>(
  repoRoot: string,
  operationName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockDir = agentExtensionsLockDir(repoRoot);
  // Ensure the parent directory exists so mkdir(lockDir) can succeed.
  await mkdir(path.dirname(lockDir), { recursive: true });
  return withDirLock(lockDir, operationName, fn);
}
