/**
 * Synchronous workspace reset on app quit.
 *
 * `before-quit` cannot rely on async work completing, so this path uses sync
 * filesystem/process operations while reopening tasks and clearing runtime state.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from '../paths';
import { createLogger } from '../log/logger';

const log = createLogger('electron/main.cleanup');

const AGENT_WORKSPACE = join(REPO_ROOT, 'AgentWorkSpace');
const DROPBOX_DIR = join(AGENT_WORKSPACE, 'dropbox');
const PENDING_DIR = join(AGENT_WORKSPACE, 'pendingitems');
const HANDOFFS_DIR = join(AGENT_WORKSPACE, 'handoffs');
const IMPL_STEPS_DIR = join(AGENT_WORKSPACE, 'ImplementationSteps');

const PLATFORM_STATE = join(REPO_ROOT, '.platform-state');
const QUEUE_STATE = join(PLATFORM_STATE, 'queue');
const RUNTIME_STATE = join(PLATFORM_STATE, 'runtime');
const TASK_REGISTRY_PATH = join(PLATFORM_STATE, 'task-registry.json');

const QUEUE_ORDER_PATH = join(QUEUE_STATE, 'queue-order.json');
const ROLE_SESSIONS_DIR = join(RUNTIME_STATE, 'role-sessions');
const CLI_HOME_DIR = join(RUNTIME_STATE, getActiveProvider(REPO_ROOT).homeDirName());

const TASKS_DIR = join(AGENT_WORKSPACE, 'tasks');
const RUNTIME_TASKS_DIR = join(RUNTIME_STATE, 'tasks');

/** Timestamp prefix prepended by `queueNameForSource` during move-to-pending. */
const QUEUE_TIMESTAMP_PREFIX_RE = /^\d{8}T\d{6}Z[-_]/;

/**
 * Full workspace reset. Designed to be called synchronously from `before-quit`.
 *
 * Ordered cleanup covers active agent PIDs, active/recoverable worktrees,
 * pending task files, task registry state, .active-items/, legacy handoff
 * artifacts, queue-order.json, and ephemeral runtime dirs.
 */
export function cleanupWorkspaceOnQuit(): void {
  // Each step is isolated so one failure does not skip subsequent steps.
  const steps = [
    killAgentPids,
    tearDownAllWorktrees,
    movePendingFilesToDropbox,
    resetTaskRegistry,
    removeActiveItemMarker,
    () => clearDirKeepGitkeep(HANDOFFS_DIR),
    () => clearDirKeepGitkeep(IMPL_STEPS_DIR),
    resetPipelineState,
    clearEphemeralRuntime,
  ];
  for (const step of steps) {
    try {
      step();
    } catch (err: unknown) {
      log.warn('cleanup.step.failed', {
        step: step.name || 'anonymous',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Kill agent processes by reading PID from each role-session receipt.
 * Scans both the legacy singleton ROLE_SESSIONS_DIR (pre-task planner sessions)
 * and per-task runtime role-sessions dirs under .platform-state/runtime/tasks/.
 */
function killAgentPids(): void {
  if (existsSync(ROLE_SESSIONS_DIR)) {
    for (const file of readdirSync(ROLE_SESSIONS_DIR)) {
      if (!file.endsWith('.json')) continue;
      try {
        const receipt = JSON.parse(readFileSync(join(ROLE_SESSIONS_DIR, file), 'utf-8'));
        if (receipt.terminal) continue;
        const pid: unknown = receipt?.launch?.pid;
        if (typeof pid === 'number' && pid > 0) {
          process.kill(pid, 'SIGTERM');
        }
      } catch { /* best-effort per receipt */ }
    }
  }

  if (!existsSync(RUNTIME_TASKS_DIR)) return;
  for (const taskId of readdirSync(RUNTIME_TASKS_DIR)) {
    const taskRoleSessionsDir = join(RUNTIME_TASKS_DIR, taskId, 'role-sessions');
    if (!existsSync(taskRoleSessionsDir)) continue;
    for (const file of readdirSync(taskRoleSessionsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const receipt = JSON.parse(readFileSync(join(taskRoleSessionsDir, file), 'utf-8'));
        if (receipt.terminal) continue;
        const pid: unknown = receipt?.launch?.pid;
        if (typeof pid === 'number' && pid > 0) {
          process.kill(pid, 'SIGTERM');
        }
      } catch { /* best-effort per receipt */ }
    }
  }
}

/**
  * Tear down every active/recoverable git worktree.
  * Walks task-registry.json and AgentWorkSpace/tasks/<taskId>/.task.json.
  * Every JSON parse is individually try/catch guarded.
  * Does NOT consult retain_failed_task_worktrees. Legacy completed sidecars are
  * preserved because completed source branches are operator handoffs.
  */
function tearDownAllWorktrees(): void {
  const seenTaskIds = new Set<string>();
  const uniqueOriginalRoots = new Set<string>();

  try {
    const raw = readFileSync(TASK_REGISTRY_PATH, 'utf-8');
    let registry: Record<string, unknown>;
    try {
      registry = JSON.parse(raw);
    } catch {
      log.warn('cleanup.task-registry.parse.failed', { path: TASK_REGISTRY_PATH });
      registry = {};
    }
    if (registry?.tasks && typeof registry.tasks === 'object') {
      for (const set of Object.values(registry.tasks as Record<string, unknown>)) {
        if (!set || typeof set !== 'object') continue;
        const taskSet = set as Record<string, unknown>;
        for (const listKey of ['active', 'pending', 'open', 'failed']) {
          const list = taskSet[listKey];
          if (!Array.isArray(list)) continue;
          for (const entry of list) {
            if (entry?.taskId && typeof entry.taskId === 'string') {
              seenTaskIds.add(entry.taskId);
            }
          }
        }
      }
    }
  } catch { /* registry file absent — proceed with tasks dir scan */ }

  // Dotfiles like .gitkeep/.DS_Store are never task IDs.
  if (existsSync(TASKS_DIR)) {
    for (const taskId of readdirSync(TASKS_DIR)) {
      if (taskId.startsWith('.')) continue;
      seenTaskIds.add(taskId);
    }
  }

  for (const taskId of seenTaskIds) {
    const taskDir = join(TASKS_DIR, taskId);
    const taskJsonPath = join(taskDir, '.task.json');

    let bindings: Array<{ originalRoot: string; worktreeRoot: string; worktreeBranch: string }> = [];
    let sidecarState: string | null = null;
    if (existsSync(taskJsonPath)) {
      try {
        const raw = readFileSync(taskJsonPath, 'utf-8');
        let sidecar: Record<string, unknown>;
        try {
          sidecar = JSON.parse(raw);
        } catch {
          log.warn('cleanup.task-json.parse.failed', { path: taskJsonPath });
          sidecar = {};
        }
        sidecarState = typeof sidecar.state === 'string' ? sidecar.state : null;
        const rawBindings = (sidecar?.contextPackBinding as Record<string, unknown> | undefined)?.repoBindings;
        if (Array.isArray(rawBindings)) {
          for (const b of rawBindings) {
            if (
              b &&
              typeof b.originalRoot === 'string' && b.originalRoot &&
              typeof b.worktreeRoot === 'string' && b.worktreeRoot &&
              typeof b.worktreeBranch === 'string' && b.worktreeBranch
            ) {
              bindings.push({
                originalRoot: b.originalRoot,
                worktreeRoot: b.worktreeRoot,
                worktreeBranch: b.worktreeBranch,
              });
            }
          }
        }
      } catch { /* IO error — skip bindings for this task, still rmSync below */ }
    }

    if (sidecarState === 'completed') {
      log.warn('cleanup.completed-sidecar.preserved', { taskId, sidecar: taskJsonPath });
      continue;
    }

    for (const binding of bindings) {
      try {
        execFileSync('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot], { stdio: 'ignore' });
      } catch { /* worktree may already be gone */ }
      try {
        execFileSync('git', ['-C', binding.originalRoot, 'branch', '-D', binding.worktreeBranch], { stdio: 'ignore' });
      } catch { /* branch may not exist */ }
      uniqueOriginalRoots.add(binding.originalRoot);
    }

    try {
      rmSync(taskDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }

  for (const originalRoot of uniqueOriginalRoots) {
    try {
      execFileSync('git', ['-C', originalRoot, 'worktree', 'prune'], { stdio: 'ignore' });
    } catch { /* best-effort */ }
  }
}

/**
 * Move every visible task file from pendingitems/ back to dropbox/.
 * Strips the queue timestamp prefix so the filename reverts to its original form.
 */
function movePendingFilesToDropbox(): void {
  if (!existsSync(PENDING_DIR)) return;
  mkdirSync(DROPBOX_DIR, { recursive: true });

  for (const file of readdirSync(PENDING_DIR)) {
    if (file.startsWith('.') || !file.endsWith('.md')) continue;

    const sourcePath = join(PENDING_DIR, file);
    const originalName = file.replace(QUEUE_TIMESTAMP_PREFIX_RE, '');
    let targetPath = join(DROPBOX_DIR, originalName);

    // Collision guard: if original name already exists in dropbox, keep the
    // timestamped name rather than silently overwriting.
    if (existsSync(targetPath)) {
      targetPath = join(DROPBOX_DIR, file);
    }

    try {
      renameSync(sourcePath, targetPath);
    } catch { /* cross-device move not expected here, skip on failure */ }
  }
}

/**
 * Rewrite the task registry: move all pending and active entries back to open.
 * Done as a direct JSON rewrite to keep it fully synchronous.
 */
function resetTaskRegistry(): void {
  if (!existsSync(TASK_REGISTRY_PATH)) return;

  try {
    const raw = readFileSync(TASK_REGISTRY_PATH, 'utf-8');
    const registry = JSON.parse(raw);
    if (!registry?.tasks) return;

    let dirty = false;

    for (const key of Object.keys(registry.tasks)) {
      const set = registry.tasks[key];

      // Tolerate legacy scalar active entries from old registries.
      const activeEntries: unknown[] = Array.isArray(set.active)
        ? set.active
        : (set.active != null ? [set.active] : []);
      if (activeEntries.length > 0) {
        set.open = set.open ?? [];
        for (const activeEntry of activeEntries as Array<{ state: string; fileName: string; taskId: string }>) {
          activeEntry.state = 'open';
          activeEntry.fileName = activeEntry.fileName.replace(QUEUE_TIMESTAMP_PREFIX_RE, '');
          activeEntry.taskId = activeEntry.fileName.replace(/\.md$/, '');
          if (!set.open.some((e: { taskId: string }) => e.taskId === activeEntry.taskId)) {
            set.open.push(activeEntry);
          }
        }
        set.active = [];
        dirty = true;
      }

      if (Array.isArray(set.pending) && set.pending.length > 0) {
        for (const entry of set.pending) {
          entry.state = 'open';
          entry.fileName = entry.fileName.replace(QUEUE_TIMESTAMP_PREFIX_RE, '');
          entry.taskId = entry.fileName.replace(/\.md$/, '');
          set.open = set.open ?? [];
          if (!set.open.some((e: { taskId: string }) => e.taskId === entry.taskId)) {
            set.open.push(entry);
          }
        }
        set.pending = [];
        dirty = true;
      }
    }

    if (dirty) {
      writeFileSync(TASK_REGISTRY_PATH, JSON.stringify(registry, null, 2));
    }
  } catch (err: unknown) {
    log.warn('cleanup.task-registry.reset.failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reset the .active-items/ directory — wipe and recreate empty.
 * Next session writes markers into this directory.
 *
 * Must use pendingitems/.active-items; AgentWorkSpace/.active-items is a stale
 * phantom location from older implementations.
 */
function removeActiveItemMarker(): void {
  const activeItemsDir = join(PENDING_DIR, '.active-items');
  rmSync(activeItemsDir, { recursive: true, force: true });
  mkdirSync(activeItemsDir, { recursive: true });
}

/** Empty the queue-order singleton. Per-task pipeline state is wiped in clearEphemeralRuntime. */
function resetPipelineState(): void {
  try {
    writeFileSync(QUEUE_ORDER_PATH, '{"order":[]}');
  } catch { /* best-effort */ }
}

/**
 * Clear provider CLI-home ephemeral directories, legacy role-session receipts,
 * and the per-task runtime tree (.platform-state/runtime/tasks/).
 */
function clearEphemeralRuntime(): void {
  if (existsSync(CLI_HOME_DIR)) {
    for (const entry of readdirSync(CLI_HOME_DIR)) {
      try { rmSync(join(CLI_HOME_DIR, entry), { recursive: true, force: true }); } catch { /* skip */ }
    }
  }

  if (existsSync(ROLE_SESSIONS_DIR)) {
    for (const entry of readdirSync(ROLE_SESSIONS_DIR)) {
      if (entry === '.gitkeep') continue;
      try { unlinkSync(join(ROLE_SESSIONS_DIR, entry)); } catch { /* skip */ }
    }
  }

  // Wipe all per-task runtime artifacts in one sync operation.
  rmSync(RUNTIME_TASKS_DIR, { recursive: true, force: true });
}

/** Remove all files in a directory except .gitkeep. */
function clearDirKeepGitkeep(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === '.gitkeep') continue;
    try {
      rmSync(join(dir, entry), { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}
