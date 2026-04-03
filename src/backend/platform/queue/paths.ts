import path from 'node:path';
import { findRepoRoot } from '../core/index.js';

/**
 * Standard handoff artifact filenames that live in AgentWorkSpace/handoffs/.
 */
export const HANDOFF_FILES: readonly string[] = [
  'professional-task.md',
  'implementation-spec.md',
  'retrospective-input.md',
  'final-summary.md',
  'issues.md',
  'parallel-ok.md',
];

/** Marker file written during the handoff publish rename loop. */
export const PUBLISH_MARKER = '.publish-in-progress';

/** Labels that appear in the Task Lineage section of handoff artifacts. */
export const LINEAGE_LABELS: readonly string[] = [
  'Task Kind',
  'Parent Task ID',
  'Root Task ID',
  'Parent QMD Record ID',
  'Parent QMD Scope',
  'Follow-Up Reason',
];

/** Resolved queue-specific paths. */
export interface QueuePaths {
  dropboxDir: string;
  pendingDir: string;
  errorItemsDir: string;
  handoffsDir: string;
  templatesDir: string;
  activeItemLink: string;
  queueLockDir: string;
  /** Runtime state: which context pack is active for the current task. */
  activeContextPackPath: string;
  /** Runtime state: queue ordering manifest. */
  queueOrderPath: string;
}

/**
 * Resolve all queue-specific paths relative to the repo root.
 */
export function resolveQueuePaths(repoRoot?: string): QueuePaths {
  const root = repoRoot ?? findRepoRoot();
  const agentWorkSpace = path.join(root, 'AgentWorkSpace');
  const pendingDir = path.join(agentWorkSpace, 'pendingitems');
  const platformQueueState = path.join(root, '.platform-state', 'queue');

  return {
    dropboxDir: path.join(agentWorkSpace, 'dropbox'),
    pendingDir,
    errorItemsDir: path.join(agentWorkSpace, 'erroritems'),
    handoffsDir: path.join(agentWorkSpace, 'handoffs'),
    templatesDir: path.join(agentWorkSpace, 'templates'),
    activeItemLink: path.join(pendingDir, '.active-item'),
    queueLockDir: path.join(pendingDir, '.queue-lock.d'),
    activeContextPackPath: path.join(platformQueueState, 'active-context-pack.json'),
    queueOrderPath: path.join(platformQueueState, 'queue-order.json'),
  };
}

/**
 * Full path to a template file inside the templates directory.
 */
export function templateSourceFor(
  templateName: string,
  templatesDir: string,
): string {
  return path.join(templatesDir, templateName);
}

/**
 * Path to the .active-item file inside the pending directory.
 */
export function activeItemPath(pendingDir: string): string {
  return path.join(pendingDir, '.active-item');
}

/**
 * Derive queue state paths from a pendingDir when the full QueuePaths object
 * is not available. Used by functions that only receive pendingDir as a parameter.
 */
export function deriveQueueStatePaths(pendingDir: string): {
  activeContextPackPath: string;
  queueOrderPath: string;
} {
  const repoRoot = path.resolve(pendingDir, '..', '..');
  const platformQueueState = path.join(repoRoot, '.platform-state', 'queue');
  return {
    activeContextPackPath: path.join(platformQueueState, 'active-context-pack.json'),
    queueOrderPath: path.join(platformQueueState, 'queue-order.json'),
  };
}
