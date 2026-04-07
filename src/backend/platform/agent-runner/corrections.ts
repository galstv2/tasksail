import type { AgentId } from '../core/index.js';
import { readTextFile } from '../core/index.js';
import path from 'node:path';
import type { ResolvedContext } from './types.js';
import { resolveBehavioralBaseRegistryId } from './conventions.js';

/** All active workflow roles consume behavior corrections. */
const CORRECTIONS_AGENTS = new Set([
  'planning-agent',
  'product-manager',
  'software-engineer',
  'qa',
]);

/**
 * Check whether an agent role requires corrections context injection.
 */
export function roleRequiresCorrections(agentId: AgentId): boolean {
  return CORRECTIONS_AGENTS.has(resolveBehavioralBaseRegistryId(agentId));
}

/**
 * Resolve corrections context for an agent.
 * Checks the QMD behavior-correction-memo for the active context pack.
 */
export async function resolveCorrectionsContext(
  agentId: AgentId,
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<ResolvedContext> {
  if (!roleRequiresCorrections(agentId)) {
    return {
      status: 'not-applicable',
      reason: 'Agent role does not require corrections context by default.',
      injectionEnabled: false,
    };
  }

  if (!contextPackDir) {
    return {
      status: 'unavailable',
      reason: 'No active context pack is selected in ACTIVE_CONTEXT_PACK_DIR.',
      injectionEnabled: false,
    };
  }

  const packName = path.basename(contextPackDir);
  const memoPath = path.join(
    contextPackDir,
    'qmd',
    'context-packs',
    packName,
    'canonical',
    'context-pack',
    'behavior-correction-memo.md',
  );

  const memoContent = await readTextFile(memoPath);
  if (memoContent === undefined) {
    return {
      status: 'unavailable',
      reason: 'No behavior correction memo has been generated yet.',
      injectionEnabled: false,
    };
  }

  const repoContextAppPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'repo-context-app.py',
  );
  const appContent = await readTextFile(repoContextAppPath);
  if (appContent === undefined) {
    return {
      status: 'malformed',
      reason: 'Repo-context corrections loader is unavailable.',
      injectionEnabled: false,
    };
  }

  return {
    status: 'available',
    reason: 'Corrections context resolution delegated to Python helper.',
    injectionEnabled: true,
    contextFile: path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'context-pack-corrections.md',
    ),
  };
}
