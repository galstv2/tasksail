import path from 'node:path';
import { readdirSync } from 'node:fs';
import { findRepoRoot } from '../core/index.js';

/**
 * Standard handoff artifact filenames that live in per-task handoffs directories.
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
  templatesDir: string;
  /**
   * Compatibility fallback: returns the single non-sentinel active-marker path
   * when exactly one exists; returns undefined for zero or two-or-more (F37).
   * Callers enumerating tasks MUST iterate activeItemsDir directly.
   */
  activeItemLink: () => string | undefined;
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
    errorItemsDir: path.join(agentWorkSpace, 'error-items'),
    templatesDir: path.join(agentWorkSpace, 'templates'),
    activeItemLink: (): string | undefined => {
      const activeItemsPath = path.join(pendingDir, '.active-items');
      let entries: string[];
      try {
        entries = readdirSync(activeItemsPath);
      } catch {
        return undefined;
      }
      const markers = entries.filter((f) => !f.endsWith('.completing'));
      if (markers.length !== 1) return undefined;
      return path.join(activeItemsPath, markers[0]!);
    },
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
 * Render an absolute artifact path under the per-task handoffs directory.
 * Use for prompt strings and user-facing remediation messages so the path
 * always reflects the active task context.
 */
export function renderHandoffArtifactPath(
  repoRoot: string,
  taskId: string,
  filename: string,
): string {
  return path.join(
    resolveQueuePaths(repoRoot).taskHandoffs(taskId),
    filename,
  );
}

/**
 * Render a relative `AgentWorkSpace/tasks/<taskId>/handoffs/<filename>`
 * label suitable for prompt text and documentation.
 */
export function renderHandoffArtifactLabel(
  taskId: string,
  filename: string,
): string {
  return `AgentWorkSpace/tasks/${taskId}/handoffs/${filename}`;
}

export function renderImplementationStepsLabel(
  taskId: string,
  filename: string,
): string {
  return `AgentWorkSpace/tasks/${taskId}/ImplementationSteps/${filename}`;
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
