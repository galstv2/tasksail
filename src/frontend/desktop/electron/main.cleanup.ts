/**
 * main.cleanup.ts — Synchronous workspace reset on app quit.
 *
 * Moves pending/active tasks back to open (dropbox), clears handoff artifacts,
 * resets pipeline state, and kills agent PIDs. Called from the `before-quit`
 * handler in main.ts.
 *
 * All operations are deliberately synchronous (readFileSync/writeFileSync/
 * renameSync) because Electron's `before-quit` event fires during shutdown
 * and async work cannot be guaranteed to complete.
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
import { join } from 'node:path';

import { REPO_ROOT } from './paths';

// ── Path constants ──────────────────────────────────────────────────────────

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
const PIPELINE_PHASE_PATH = join(RUNTIME_STATE, 'pipeline-phase.json');
const PIPELINE_LOCK_PATH = join(RUNTIME_STATE, 'pipeline.lock');
const ROLE_SESSIONS_DIR = join(RUNTIME_STATE, 'role-sessions');
const COPILOT_HOME_DIR = join(RUNTIME_STATE, 'copilot-home');

/** Timestamp prefix prepended by `queueNameForSource` during move-to-pending. */
const QUEUE_TIMESTAMP_PREFIX_RE = /^\d{8}T\d{6}Z[-_]/;

// ── Core cleanup ────────────────────────────────────────────────────────────

/**
 * Full workspace reset. Designed to be called synchronously from `before-quit`.
 *
 * 1. Kill active agent PIDs (from role-session receipts)
 * 2. Move pending task files back to dropbox
 * 3. Update task registry: pending/active → open
 * 4. Remove .active-item marker
 * 5. Clear handoff artifacts and ImplementationSteps
 * 6. Reset pipeline state (phase, lock, queue order)
 * 7. Clean up ephemeral runtime dirs (copilot-home, role-sessions)
 */
export function cleanupWorkspaceOnQuit(): void {
  // Each step is isolated so one failure does not skip subsequent steps.
  const steps = [
    killAgentPids,
    movePendingFilesToDropbox,
    resetTaskRegistry,
    removeActiveItemMarker,
    () => clearDirKeepGitkeep(HANDOFFS_DIR),
    () => clearDirKeepGitkeep(IMPL_STEPS_DIR),
    resetPipelineState,
    clearEphemeralRuntime,
  ];
  for (const step of steps) {
    try { step(); } catch { /* best-effort */ }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Kill agent processes by reading PID from each role-session receipt.
 * Mirrors the existing logic in main.ts `before-quit` handler.
 */
function killAgentPids(): void {
  if (!existsSync(ROLE_SESSIONS_DIR)) return;
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

/**
 * Move every visible .md file from pendingitems/ back to dropbox/.
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

      // active is now TaskRegistryEntry[] (schema v2); tolerate legacy scalar (v1)
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
  } catch { /* best-effort */ }
}

/** Remove the .active-item marker that the recovery controller checks on startup. */
function removeActiveItemMarker(): void {
  try { unlinkSync(join(PENDING_DIR, '.active-item')); } catch { /* ENOENT is fine */ }
}

/** Reset pipeline phase to idle, clear the lock, and empty the queue order. */
function resetPipelineState(): void {
  try {
    writeFileSync(PIPELINE_PHASE_PATH, JSON.stringify({
      phase: 'idle',
      timestamp: new Date().toISOString(),
    }));
  } catch { /* best-effort */ }

  rmSync(PIPELINE_LOCK_PATH, { recursive: true, force: true });

  try {
    writeFileSync(QUEUE_ORDER_PATH, '{"order":[]}');
  } catch { /* best-effort */ }
}

/** Clear copilot-home ephemeral directories and role-session receipts. */
function clearEphemeralRuntime(): void {
  if (existsSync(COPILOT_HOME_DIR)) {
    for (const entry of readdirSync(COPILOT_HOME_DIR)) {
      try { rmSync(join(COPILOT_HOME_DIR, entry), { recursive: true, force: true }); } catch { /* skip */ }
    }
  }

  if (existsSync(ROLE_SESSIONS_DIR)) {
    for (const entry of readdirSync(ROLE_SESSIONS_DIR)) {
      if (entry === '.gitkeep') continue;
      try { unlinkSync(join(ROLE_SESSIONS_DIR, entry)); } catch { /* skip */ }
    }
  }
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
