/**
 * §6.3 + F34 — Container and Compose project naming.
 *
 * Docker container names are bounded at 63 chars. `repo-context-mcp-` is a
 * 17-char prefix, so the task slug must be ≤46 chars. F34 codifies that with
 * the regex `^[a-z0-9][-a-z0-9]{0,45}$` (1-46 chars, alnum first, alnum-or-dash
 * after). Compose project names use the shorter `tasksail-` (9-char) prefix;
 * the tighter constraint comes from the container-name path.
 *
 * Slug derivation has two branches:
 *   - Passthrough: lowercase, non-[a-z0-9-] → '-', collapse dashes, trim
 *     leading/trailing dashes. If the result fits F34, return it.
 *   - Sha256 fallback: first 16 chars of sha256(taskId) in lowercase hex.
 *     Always satisfies F34 because hex chars are in `[a-f0-9] ⊂ [a-z0-9]` and
 *     16 ≤ 46.
 *
 * Contract for the task lifecycle:
 *   - `composeProjectName(taskId)` MUST be passed to `allocate()` as the
 *     second arg so orphan-sweep and composeDownTask can correlate port ↔
 *     project.
 *   - `repoContextMcpContainerName(taskId)` is surfaced to compose via the
 *     `REPO_CONTEXT_MCP_CONTAINER_NAME` env var (see §6.1 compose file).
 */
import { createHash } from 'node:crypto';

export const COMPOSE_PROJECT_NAME_PREFIX = 'tasksail-';
export const REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX = 'repo-context-mcp-';

export const TASK_SLUG_MAX_LEN = 46;

const SLUG_SAFE_RE = /^[a-z0-9][-a-z0-9]{0,45}$/;

/**
 * Derive a Docker-safe slug from a task id per F34.
 */
export function taskContainerSlug(taskId: string, peers?: Iterable<string>): string {
  const sanitized = taskId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  let collides = false;
  if (peers && typeof (peers as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') {
    for (const peer of peers) {
      if (peer === taskId) continue;
      const peerSlug = peer
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (peerSlug === sanitized) {
        collides = true;
        break;
      }
    }
  }

  if (
    !collides &&
    sanitized.length > 0 &&
    sanitized.length <= TASK_SLUG_MAX_LEN &&
    SLUG_SAFE_RE.test(sanitized)
  ) {
    return sanitized;
  }

  return createHash('sha256').update(taskId).digest('hex').slice(0, 16);
}

export function composeProjectName(taskId: string, peers?: Iterable<string>): string {
  return `${COMPOSE_PROJECT_NAME_PREFIX}${taskContainerSlug(taskId, peers)}`;
}

export function repoContextMcpContainerName(taskId: string, peers?: Iterable<string>): string {
  return `${REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX}${taskContainerSlug(taskId, peers)}`;
}
