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

/** Canonical starter-slice template filename staged into ImplementationSteps/. */
export const SLICE_TEMPLATE_FILENAME = 'slice-template.md';

/** Directory name that stores execution slices for the active task. */
export const IMPLEMENTATION_STEPS_DIRNAME = 'ImplementationSteps';

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
  /**
   * Directory that holds per-task active markers in parallel mode.
   * Each running task writes a file here instead of the singleton .active-item.
   */
  activeItemsDir: string;
  /** Per-task worktree root: AgentWorkSpace/tasks/<taskId>. */
  taskWorktree: (taskId: string) => string;
  /** Per-task handoffs directory: AgentWorkSpace/tasks/<taskId>/handoffs. */
  taskHandoffs: (taskId: string) => string;
  /** Per-task ImplementationSteps directory: AgentWorkSpace/tasks/<taskId>/ImplementationSteps. */
  taskImplementationSteps: (taskId: string) => string;
  /** Per-task .task.json sidecar path: AgentWorkSpace/tasks/<taskId>/.task.json. */
  taskContextPackSidecar: (taskId: string) => string;
}

/**
 * Resolve all queue-specific paths relative to the repo root.
 */
export function resolveQueuePaths(repoRoot?: string): QueuePaths {
  const root = repoRoot ?? findRepoRoot();
  const agentWorkSpace = path.join(root, 'AgentWorkSpace');
  const pendingDir = path.join(agentWorkSpace, 'pendingitems');
  const platformQueueState = path.join(root, '.platform-state', 'queue');

  const tasksDir = path.join(agentWorkSpace, 'tasks');

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
    activeItemsDir: path.join(pendingDir, '.active-items'),
    taskWorktree: (taskId: string) => path.join(tasksDir, taskId),
    taskHandoffs: (taskId: string) => path.join(tasksDir, taskId, 'handoffs'),
    taskImplementationSteps: (taskId: string) => path.join(tasksDir, taskId, 'ImplementationSteps'),
    taskContextPackSidecar: (taskId: string) => path.join(tasksDir, taskId, '.task.json'),
  };
}

/**
 * Resolve the ImplementationSteps directory for a repo root.
 */
export function implementationStepsDirFor(repoRoot?: string): string {
  const root = repoRoot ?? findRepoRoot();
  return path.join(root, 'AgentWorkSpace', IMPLEMENTATION_STEPS_DIRNAME);
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
 * Resolve the canonical slice-template placeholder inside ImplementationSteps/.
 */
export function implementationStepsTemplatePath(
  implementationStepsDir: string,
): string {
  return path.join(implementationStepsDir, SLICE_TEMPLATE_FILENAME);
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
