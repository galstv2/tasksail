/**
 * §5.2 Pipeline Supervisor — in-process singleton for managing pipeline child processes.
 *
 * Process boundary: loaded by both Electron main process and CLI entrypoint.
 * NOT an IPC server — all subscribe/unsubscribe are direct function calls.
 *
 * Co-ships with §5.4 (subscribeTask/unsubscribeTask exports) and §5.5 (MG-3 + MG-11).
 */
import { createInterface } from 'node:readline';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { spawnPipelineForTask } from './spawnPipeline.js';
import { moveFailedItemToErrorItems } from '../queue/errorItems.js';
import { finalizeTaskWorktrees } from '../core/worktreeFinalize.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineEntry = {
  taskId: string;
  pid: number;
  startedAt: string;
};

// ---------------------------------------------------------------------------
// Module-scope state (singleton)
// ---------------------------------------------------------------------------

/** Map of taskId → live pipeline entry. */
const pidMap = new Map<string, PipelineEntry & { exitPromise: Promise<number>; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream }>();

/**
 * F36 — ephemeral in-flight lock map.
 * Keyed by taskId. Claimed synchronously at the top of startPipeline BEFORE the
 * first await, so concurrent duplicate calls converge on a single spawn.
 * Cleared once the entry is committed to pidMap (or spawn fails).
 */
const startingMap = new Map<string, Promise<{ status: 'started'; pid: number }>>();

/**
 * F5 — isRecovering guard.
 * While recoverOnStartup is in progress, startPipeline calls return { deferred: true }.
 */
let isRecovering = false;

// ---------------------------------------------------------------------------
// Port stub — TODO(§6.2): replace with portAllocator.release(taskId)
// ---------------------------------------------------------------------------

async function releasePortStub(taskId: string, repoRoot: string): Promise<void> {
  const tablePath = path.join(repoRoot, '.platform-state', 'runtime', 'port-allocations.json');
  try {
    const { readFile: rf, writeFile: wf, rename: ren } = await import('node:fs/promises');
    const raw = await rf(tablePath, 'utf-8');
    let table: Record<string, unknown>;
    try { table = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    if (!(taskId in table)) return;
    delete table[taskId];
    const tmpPath = tablePath + '.tmp';
    await wf(tmpPath, JSON.stringify(table, null, 2) + '\n', 'utf-8');
    await ren(tmpPath, tablePath);
  } catch {
    // ENOENT or I/O error — swallow
  }
}

// ---------------------------------------------------------------------------
// Child stdout/stderr envelope (MUST per §5.2)
// ---------------------------------------------------------------------------

type ChildOutputEnvelope = {
  type: 'stdout' | 'stderr';
  taskId: string;
  line: string;
  ts: number;
};

function wrapChildOutput(
  taskId: string,
  stream: NodeJS.ReadableStream,
  type: 'stdout' | 'stderr',
): void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const envelope: ChildOutputEnvelope = {
      type,
      taskId,
      line,
      ts: Date.now(),
    };
    // Forward to process output so the parent can observe pipeline output.
    // Callers that need structured access can intercept before this point.
    process.stdout.write(JSON.stringify(envelope) + '\n');
  });
}

// ---------------------------------------------------------------------------
// Child-exit handler (MUST per §5.2 blast-radius critical)
// ---------------------------------------------------------------------------

async function handleChildExit(
  taskId: string,
  repoRoot: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): Promise<void> {
  // Remove from pid map first so concurrent peers are not affected.
  pidMap.delete(taskId);

  if (code === 0 && signal === null) {
    // F: success path. Child triggers its own cleanup via completePendingItem.
    return;
  }

  // Failure path: move to error-items for THIS taskId only.
  // MUST NOT iterate pidMap or call stopAll — peer children are still live.
  try {
    await moveFailedItemToErrorItems({ repoRoot, taskId });
  } catch (err) {
    console.error(`[pipelineSupervisor] moveFailedItemToErrorItems failed for ${taskId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * F25 — startPipeline idempotency (MUST).
 * If taskId is already in the pid map, returns { status: 'already-running', pid }.
 * While isRecovering, returns { deferred: true }.
 */
export async function startPipeline(
  taskId: string,
  repoRoot: string,
): Promise<{ status: 'started'; pid: number } | { status: 'already-running'; pid: number } | { deferred: true }> {
  // F5 guard
  if (isRecovering) {
    return { deferred: true };
  }

  // F25 idempotency — fast path: already committed to pidMap.
  const existing = pidMap.get(taskId);
  if (existing) {
    return { status: 'already-running', pid: existing.pid };
  }

  // F36 — synchronous in-flight check. If another caller is mid-spawn for the
  // same taskId, await its pid and return 'already-running'. This closes the
  // TOCTOU hole across the await spawnPipelineForTask boundary.
  const inFlight = startingMap.get(taskId);
  if (inFlight) {
    const result = await inFlight;
    return { status: 'already-running', pid: result.pid };
  }

  // Claim the slot BEFORE awaiting anything. The promise we publish here must
  // be the same promise the function returns so concurrent callers observe the
  // same outcome.
  const startPromise = (async (): Promise<{ status: 'started'; pid: number }> => {
    const child = await spawnPipelineForTask({ taskId, repoRoot });
    const startedAt = new Date().toISOString();

    pidMap.set(taskId, {
      taskId,
      pid: child.pid,
      startedAt,
      exitPromise: child.exit,
      stdout: child.stdout,
      stderr: child.stderr,
    });

    // Wrap stdio in typed envelopes (MUST per §5.2 child stdout/stderr envelope contract).
    wrapChildOutput(taskId, child.stdout, 'stdout');
    wrapChildOutput(taskId, child.stderr, 'stderr');

    // Register exit handler with closure over captured taskId (MUST per §5.2 blast-radius).
    void child.exit.then((code) => {
      void handleChildExit(taskId, repoRoot, code ?? null, null);
    });

    return { status: 'started', pid: child.pid };
  })();

  startingMap.set(taskId, startPromise);
  try {
    return await startPromise;
  } finally {
    startingMap.delete(taskId);
  }
}

/**
 * Stop the pipeline for a specific taskId.
 * Sends SIGTERM, waits up to stopGracePeriodMs, then SIGKILL.
 * MUST signal ONLY the child registered for taskId — NOT peers.
 */
export async function stopPipeline(
  taskId: string,
  stopGracePeriodMs = 15_000,
): Promise<void> {
  const entry = pidMap.get(taskId);
  if (!entry) return;

  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch {
    // Process may have already exited — ignore.
  }

  const result = await Promise.race([
    entry.exitPromise,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), stopGracePeriodMs)),
  ]);

  if (result === 'timeout') {
    try {
      process.kill(entry.pid, 'SIGKILL');
    } catch {
      // Process may have already exited.
    }
    await Promise.race([
      entry.exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, stopGracePeriodMs)),
    ]);
  }

  pidMap.delete(taskId);
}

/**
 * Stop all tracked pipelines. GLOBAL-ONLY.
 * Legitimate callers: main.ts pre-quit hook and Vitest teardown helpers.
 * MUST NOT be called from any in-session failure path, child-exit handler,
 * per-task IPC handler, or §4.10's sync quit cleanup.
 */
export async function stopAll(): Promise<void> {
  const taskIds = [...pidMap.keys()];
  await Promise.all(taskIds.map((taskId) => stopPipeline(taskId)));
}

/**
 * Returns the list of taskIds currently tracked in the pid map.
 */
export function listActivePipelines(): Array<{ taskId: string; pid: number; startedAt: string }> {
  return [...pidMap.values()].map(({ taskId, pid, startedAt }) => ({ taskId, pid, startedAt }));
}

// ---------------------------------------------------------------------------
// recoverOnStartup — 5-step sequence (§5.2)
// ---------------------------------------------------------------------------

/**
 * F5 — recoverOnStartup MUST be awaited before the dropbox watcher, recovery
 * controller, or any IPC handler that can trigger activation.
 */
export async function recoverOnStartup(repoRoot: string): Promise<void> {
  // F5: set the guard so startPipeline defers during recovery.
  isRecovering = true;

  try {
    await _recoverOnStartupImpl(repoRoot);
  } finally {
    // F5: always clear the guard, even on error.
    isRecovering = false;
  }
}

async function _recoverOnStartupImpl(repoRoot: string): Promise<void> {
  const activeItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-items');

  // ── Step 1: Singleton migration ──────────────────────────────────────────
  // If legacy `.active-item` file exists, synthesize taskId and write a marker.
  const legacyActiveItemPath = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems', '.active-item');
  if (existsSync(legacyActiveItemPath)) {
    try {
      const content = (await readFile(legacyActiveItemPath, 'utf-8')).trim();
      if (content && content.endsWith('.md')) {
        const taskId = content.replace(/\.md$/, '');
        // Write per-task marker
        try {
          const { mkdir, writeFile: wf } = await import('node:fs/promises');
          await mkdir(activeItemsDir, { recursive: true });
          await wf(path.join(activeItemsDir, taskId), content, 'utf-8');
        } catch { /* best-effort */ }
        // Delete legacy file
        try { unlinkSync(legacyActiveItemPath); } catch { /* best-effort */ }
        console.log(`[pipelineSupervisor] migrated-singleton-active-item: ${taskId}`);
      }
    } catch {
      // Best-effort migration — don't block recovery.
    }
  }

  // ── Step 2: Orphan-branch sweep ──────────────────────────────────────────
  // Read all .task.json files to get taskIds for carveout checks.
  let knownTaskIds = new Set<string>();
  const tasksSidecarDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks');
  try {
    const taskDirs = await readdir(tasksSidecarDir);
    for (const tDir of taskDirs) {
      const tjPath = path.join(tasksSidecarDir, tDir, '.task.json');
      if (existsSync(tjPath)) {
        knownTaskIds.add(tDir);
      }
    }
  } catch { /* absent */ }

  // Get .active-items marker taskIds (not including .completing sentinels)
  let activeMarkerTaskIds: string[] = [];
  try {
    const entries = await readdir(activeItemsDir);
    activeMarkerTaskIds = entries.filter((f) => !f.endsWith('.completing'));
  } catch { /* absent */ }
  const activeMarkerSet = new Set(activeMarkerTaskIds);

  // Get error-items for carveout (retained-for-inspection failed tasks)
  let errorItemTaskIds = new Set<string>();
  try {
    const errorItemsDir = path.join(repoRoot, 'AgentWorkSpace', 'error-items');
    const errorEntries = await readdir(errorItemsDir);
    for (const f of errorEntries.filter((e) => e.endsWith('.md') && !e.startsWith('.'))) {
      errorItemTaskIds.add(f.replace(/\.md$/, ''));
    }
  } catch { /* absent */ }

  // Get pending items for carveout
  let pendingItemTaskIds = new Set<string>();
  try {
    const pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    const pendingEntries = await readdir(pendingDir);
    for (const f of pendingEntries.filter((e) => e.endsWith('.md') && !e.startsWith('.'))) {
      pendingItemTaskIds.add(f.replace(/\.md$/, ''));
    }
  } catch { /* absent */ }

  // Get completing sentinels for carveout
  let completingSentinelTaskIds = new Set<string>();
  try {
    const entries = await readdir(activeItemsDir);
    for (const f of entries.filter((e) => e.endsWith('.completing'))) {
      completingSentinelTaskIds.add(f.replace(/\.completing$/, ''));
    }
  } catch { /* absent */ }

  // Enumerate git task/* branches and prune orphans
  try {
    const { execFile: ef } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(ef);

    // First prune stale worktree admin refs
    try {
      await execFileAsync('git', ['worktree', 'prune'], { cwd: repoRoot });
    } catch { /* best-effort */ }

    const { stdout: branchOutput } = await execFileAsync(
      'git',
      ['for-each-ref', 'refs/heads/task/', '--format=%(refname:short)'],
      { cwd: repoRoot },
    );

    const taskBranches = branchOutput.trim().split('\n').filter(Boolean);
    for (const branch of taskBranches) {
      const branchTaskId = branch.replace(/^task\//, '');
      // Carveout: keep if any of (a) active marker, (b) pending item, (c) error-items, (d) completing sentinel
      const hasCarveout =
        activeMarkerSet.has(branchTaskId) ||
        pendingItemTaskIds.has(branchTaskId) ||
        errorItemTaskIds.has(branchTaskId) ||
        completingSentinelTaskIds.has(branchTaskId);

      if (!hasCarveout) {
        try {
          await execFileAsync('git', ['branch', '-D', branch], { cwd: repoRoot });
        } catch {
          // Skip — worktree dir may still exist (valid retained worktree).
        }
      }
    }
  } catch {
    // git may not be available or repo may have no branches — skip.
  }

  // ── Step 3: Crash-recovery scan (per-marker) ────────────────────────────
  let markers: string[] = [];
  try {
    const entries = await readdir(activeItemsDir);
    markers = entries.filter((f) => !f.endsWith('.completing'));
  } catch { /* absent */ }

  for (const markerTaskId of markers) {
    // Check if pid is still live via latest role-session receipt
    const taskRuntime = path.join(repoRoot, '.platform-state', 'runtime', 'tasks', markerTaskId);
    let pidIsAlive = false;
    try {
      const roleSessionsDir = path.join(taskRuntime, 'role-sessions');
      if (existsSync(roleSessionsDir)) {
        const sessionFiles = readdirSync(roleSessionsDir).filter((f) => f.endsWith('.json'));
        for (const sf of sessionFiles) {
          try {
            const raw = JSON.parse(await readFile(path.join(roleSessionsDir, sf), 'utf-8')) as Record<string, unknown>;
            const launch = raw.launch as Record<string, unknown> | undefined;
            const pid = typeof launch?.pid === 'number' ? launch.pid : null;
            if (pid) {
              try { process.kill(pid, 0); pidIsAlive = true; break; } catch { /* not alive */ }
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch { /* role-sessions may not exist */ }

    if (pidIsAlive) {
      // Task still running — skip crash recovery for this task.
      continue;
    }

    // Classify outcome via sentinel
    const sentinelPath = path.join(activeItemsDir, `${markerTaskId}.completing`);
    let outcome: 'completed' | 'failed' = existsSync(sentinelPath) ? 'completed' : 'failed';

    // 3b: Missing .task.json branch
    const taskJsonPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', markerTaskId, '.task.json');
    if (!existsSync(taskJsonPath)) {
      // Override to failed regardless of sentinel presence
      outcome = 'failed';
      console.log(`[pipelineSupervisor] task-crash-recovered: { taskId: "${markerTaskId}", reason: "missing-task-json", reclassifiedAs: "failed" }`);

      // Release port (best-effort)
      await releasePortStub(markerTaskId, repoRoot);

      // Skip archival and finalizeTaskWorktrees (no bindings to tear down)
      // Proceed to step 3e+: registry transition handled by moveFailedItemToErrorItems
      try {
        await moveFailedItemToErrorItems({ repoRoot, taskId: markerTaskId });
      } catch { /* best-effort */ }

      // 3g: Remove marker
      try { unlinkSync(path.join(activeItemsDir, markerTaskId)); } catch { /* best-effort */ }
      // 3h: Remove sentinel
      try { unlinkSync(sentinelPath); } catch { /* best-effort ENOENT */ }
      continue;
    }

    // 3c: If completed and not yet archived, re-drive archival (idempotent)
    // We check via outcome classification — if completed, let finalizeTaskWorktrees handle it.

    // 3d: Invoke finalizeTaskWorktrees (MANDATORY unless step 3b fired)
    try {
      await finalizeTaskWorktrees(markerTaskId, outcome, repoRoot);
    } catch (err) {
      console.error(`[pipelineSupervisor] finalizeTaskWorktrees failed for ${markerTaskId}:`, err);
    }

    // 3e: Transition registry + handle failure case
    if (outcome === 'failed') {
      try {
        await moveFailedItemToErrorItems({ repoRoot, taskId: markerTaskId });
      } catch { /* best-effort */ }
    }

    // 3f: Emit task-crash-recovered
    console.log(`[pipelineSupervisor] task-crash-recovered: { taskId: "${markerTaskId}", reason: "pid-gone", reclassifiedAs: "${outcome}" }`);

    // 3g: Remove marker
    try { unlinkSync(path.join(activeItemsDir, markerTaskId)); } catch { /* best-effort */ }
    // 3h: Remove sentinel
    try { unlinkSync(sentinelPath); } catch { /* best-effort ENOENT */ }
  }

  // ── Step 4: Orphan sweep ─────────────────────────────────────────────────
  // Clean up stranded Docker/Podman containers (defense-in-depth).
  // Also clean up orphan .completing sentinels with no sibling marker.

  // 4a: Remove orphan .completing sentinels with no sibling marker
  try {
    const sentinelEntries = (await readdir(activeItemsDir)).filter((f) => f.endsWith('.completing'));
    for (const sentinel of sentinelEntries) {
      const siblingTaskId = sentinel.replace(/\.completing$/, '');
      const siblingMarker = path.join(activeItemsDir, siblingTaskId);
      if (!existsSync(siblingMarker)) {
        try { unlinkSync(path.join(activeItemsDir, sentinel)); } catch { /* best-effort */ }
      }
    }
  } catch { /* absent */ }

  // 4b: Container sweep (best-effort — skip if runtime unavailable)
  // This is a stub — full implementation requires §6.3 (containerNaming, composeProjectName in .task.json).
  // We skip the container enumeration here and log a warning.
  // TODO(§6.3): implement full orphan-container sweep using containerNaming.ts prefix.

  // ── Step 5: F36 assertion — lock map MUST be empty ───────────────────────
  // The pidMap starts empty (module-scope initialization) and remains empty
  // after recovery — in-flight operations cannot survive a process restart.
  // No reconstruction is attempted (per F36 spec).
  // Assertion: pidMap.size === 0 at end of recoverOnStartup.
  if (pidMap.size !== 0) {
    console.error('[pipelineSupervisor] F36 violation: pid map is not empty after recoverOnStartup');
  }
}
