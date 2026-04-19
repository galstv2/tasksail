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
import { execFileSync } from 'node:child_process';
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
const ROLE_SESSIONS_DIR = join(RUNTIME_STATE, 'role-sessions');
const COPILOT_HOME_DIR = join(RUNTIME_STATE, 'copilot-home');

const TASKS_DIR = join(AGENT_WORKSPACE, 'tasks');
const RUNTIME_TASKS_DIR = join(RUNTIME_STATE, 'tasks');

/** Timestamp prefix prepended by `queueNameForSource` during move-to-pending. */
const QUEUE_TIMESTAMP_PREFIX_RE = /^\d{8}T\d{6}Z[-_]/;

// ── Core cleanup ────────────────────────────────────────────────────────────

/**
 * Full workspace reset. Designed to be called synchronously from `before-quit`.
 *
 * 1. Kill active agent PIDs (from role-session receipts — legacy singleton + per-task)
 * 2. Tear down every worktree unconditionally
 * 2b. Compose-down every `tasksail-*` project (§6.3B quit-time prefix scan)
 * 3. Move pending task files back to dropbox
 * 4. Update task registry: pending/active → open
 * 5. Reset .active-items/ directory
 * 6. Clear handoff artifacts and ImplementationSteps (legacy singleton defensive no-ops)
 * 7. Reset pipeline state (queue-order.json only — per-task paths wiped in step 8)
 * 8. Clean up ephemeral runtime dirs (copilot-home, role-sessions, runtime/tasks/)
 * 9. Delete port-allocations table and lock
 */
export function cleanupWorkspaceOnQuit(): void {
  // Each step is isolated so one failure does not skip subsequent steps.
  const steps = [
    killAgentPids,               // step 1
    tearDownAllWorktrees,        // step 2
    composeDownTaskScopedProjects, // step 2b (§6.3B)
    movePendingFilesToDropbox,   // step 3
    resetTaskRegistry,           // step 4
    removeActiveItemMarker,      // step 5
    () => clearDirKeepGitkeep(HANDOFFS_DIR),   // step 6a
    () => clearDirKeepGitkeep(IMPL_STEPS_DIR), // step 6b
    resetPipelineState,          // step 7
    clearEphemeralRuntime,       // step 8
    clearPortAllocations,        // step 9
  ];
  for (const step of steps) {
    try { step(); } catch { /* best-effort */ }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Kill agent processes by reading PID from each role-session receipt.
 * Scans both the legacy singleton ROLE_SESSIONS_DIR (pre-task planner sessions)
 * and per-task runtime role-sessions dirs under .platform-state/runtime/tasks/.
 */
function killAgentPids(): void {
  // Legacy singleton scan (pre-task planner sessions)
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

  // Per-task scan: .platform-state/runtime/tasks/*/role-sessions/*.json
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
 * Tear down every git worktree unconditionally.
 * Walks task-registry.json and AgentWorkSpace/tasks/<taskId>/.task.json.
 * Every JSON parse is individually try/catch guarded.
 * Unconditional — does NOT consult retain_failed_task_worktrees.
 */
function tearDownAllWorktrees(): void {
  const seenTaskIds = new Set<string>();
  const uniqueOriginalRoots = new Set<string>();

  // Collect task IDs from task-registry.json
  try {
    const raw = readFileSync(TASK_REGISTRY_PATH, 'utf-8');
    let registry: Record<string, unknown>;
    try {
      registry = JSON.parse(raw);
    } catch {
      console.warn('cleanup-json-parse-failed', TASK_REGISTRY_PATH);
      registry = {};
    }
    // registry.tasks is a map of contextPackId → task-set; collect taskIds from active/pending entries
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

  // Collect task IDs from AgentWorkSpace/tasks/*/
  // Skip dotfiles (e.g. .gitkeep, .DS_Store) — they are never valid task IDs
  // and would otherwise be passed to rmSync below as if they were task dirs.
  if (existsSync(TASKS_DIR)) {
    for (const taskId of readdirSync(TASKS_DIR)) {
      if (taskId.startsWith('.')) continue;
      seenTaskIds.add(taskId);
    }
  }

  // Tear down worktrees for each task
  for (const taskId of seenTaskIds) {
    const taskDir = join(TASKS_DIR, taskId);
    const taskJsonPath = join(taskDir, '.task.json');

    // Parse .task.json — individually guarded
    let bindings: Array<{ originalRoot: string; worktreeRoot: string; worktreeBranch: string }> = [];
    if (existsSync(taskJsonPath)) {
      try {
        const raw = readFileSync(taskJsonPath, 'utf-8');
        let sidecar: Record<string, unknown>;
        try {
          sidecar = JSON.parse(raw);
        } catch {
          console.warn('cleanup-json-parse-failed', taskJsonPath);
          sidecar = {};
        }
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

    // Git teardown per binding
    for (const binding of bindings) {
      try {
        execFileSync('git', ['-C', binding.originalRoot, 'worktree', 'remove', '--force', binding.worktreeRoot], { stdio: 'ignore' });
      } catch { /* worktree may already be gone */ }
      try {
        execFileSync('git', ['-C', binding.originalRoot, 'branch', '-D', binding.worktreeBranch], { stdio: 'ignore' });
      } catch { /* branch may not exist */ }
      uniqueOriginalRoots.add(binding.originalRoot);
    }

    // Reclaim task dir — runs regardless of JSON parse outcome
    try {
      rmSync(taskDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }

  // git worktree prune once per unique originalRoot
  for (const originalRoot of uniqueOriginalRoots) {
    try {
      execFileSync('git', ['-C', originalRoot, 'worktree', 'prune'], { stdio: 'ignore' });
    } catch { /* best-effort */ }
  }
}

/**
 * §6.3B quit-time compose teardown.
 *
 * Enumerate every compose project whose name starts with `tasksail-` and run
 * `<backend> compose -p <project> down` on each. Runs fully synchronously via
 * execFileSync because Electron's before-quit cannot await async work.
 *
 * Backend is read from `.platform-state/platform.json` (container_runtime);
 * defaults to `docker` if the config is unreadable. If the configured backend
 * is not installed, the whole step is a silent no-op.
 */
function composeDownTaskScopedProjects(): void {
  const backend = readContainerBackendSync();

  let projectsRaw: string;
  try {
    projectsRaw = execFileSync(
      backend,
      ['compose', 'ls', '--all', '--format', 'json'],
      // timeout: 2s — if the docker daemon socket hangs (stopped daemon, CI
      // env, test sandbox) execFileSync would otherwise block the entire
      // before-quit path. 2s is well under Vitest's 5s default timeout and
      // short enough that operators quitting the app never feel it.
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 },
    );
  } catch {
    return; // Compose CLI missing, hung, or failed — nothing to reap.
  }

  let projects: unknown;
  try {
    projects = JSON.parse(projectsRaw);
  } catch {
    return;
  }
  if (!Array.isArray(projects)) return;

  for (const raw of projects) {
    const name =
      raw && typeof raw === 'object' && 'Name' in raw && typeof (raw as { Name: unknown }).Name === 'string'
        ? (raw as { Name: string }).Name
        : undefined;
    if (!name || !name.startsWith('tasksail-')) continue;
    try {
      execFileSync(backend, ['compose', '-p', name, 'down'], { stdio: 'ignore', timeout: 2000 });
    } catch { /* best-effort per project (includes timeout) */ }
  }
}

function readContainerBackendSync(): 'docker' | 'podman' {
  try {
    const raw = readFileSync(join(PLATFORM_STATE, 'platform.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { container_runtime?: unknown };
    return cfg.container_runtime === 'podman' ? 'podman' : 'docker';
  } catch {
    return 'docker';
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

/**
 * Reset the .active-items/ directory — wipe and recreate empty.
 * Next session writes markers into this directory.
 */
function removeActiveItemMarker(): void {
  const activeItemsDir = join(AGENT_WORKSPACE, '.active-items');
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
 * Clear copilot-home ephemeral directories, legacy role-session receipts,
 * and the per-task runtime tree (.platform-state/runtime/tasks/).
 */
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

  // Wipe the per-task runtime tree (guardrails, role-sessions, pipeline-phase,
  // pipeline.lock, kill-switch — all per-task under .platform-state/runtime/tasks/<taskId>/).
  rmSync(RUNTIME_TASKS_DIR, { recursive: true, force: true });
}

/** Delete port-allocations table and lock. Next session re-creates on first allocate. */
function clearPortAllocations(): void {
  rmSync(join(RUNTIME_STATE, 'port-allocations.json'), { force: true });
  rmSync(join(RUNTIME_STATE, 'port-allocations.json.lock'), { recursive: true, force: true });
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
