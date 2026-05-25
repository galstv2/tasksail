/**
 * §5.2 Pipeline Supervisor — in-process singleton for managing pipeline child processes.
 *
 * Process boundary: loaded by both Electron main process and CLI entrypoint.
 * NOT an IPC server — callers interact through direct function calls.
 *
 * Includes MG-3 and MG-11 runtime safeguards.
 */
import { createInterface } from 'node:readline';
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { spawnPipelineForTask } from './spawnPipeline.js';
import { CLOSEOUT_FAILURE_EXIT_CODE } from './pipeline/sequencer.js';
import { moveFailedItemToErrorItems } from '../queue/errorItems.js';
import { createLogger, writeProtocolStdout } from '../core/index.js';
import { finalizeTaskWorktrees, sweepRuntimeGC } from '../core/worktreeFinalize.js';
import { isChildChainSourceBranchProtected } from '../core/worktreeBranchOwnership.js';
import { readChildTaskChains, type ChildTaskChainsState } from '../queue/childTaskChains.js';
import { recoverStuckMidCompletion } from '../queue/recoverStuckMidCompletion.js';
import { resumeCloseoutFromSentinel } from '../queue/resumeCloseout.js';
import { resolveQueuePaths } from '../queue/paths.js';
import { sweepActivationProgressMarkers } from '../queue/activationProgress.js';

const log = createLogger('platform/agent-runner/pipelineSupervisor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PipelineEntry = {
  taskId: string;
  pid: number;
  startedAt: string;
  cleanupOwner?: 'caller' | 'child-exit-handler';
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
    writeProtocolStdout(JSON.stringify(envelope) + '\n');
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
  const entry = pidMap.get(taskId);
  pidMap.delete(taskId);
  if (entry?.cleanupOwner === 'caller') {
    return;
  }

  if (code === 0 && signal === null) {
    // F: success path. Child triggers its own cleanup via completePendingItem.
    return;
  }

  if (code === CLOSEOUT_FAILURE_EXIT_CODE) {
    let resumed = false;
    try {
      const result = await resumeCloseoutFromSentinel(taskId, repoRoot);
      resumed = result.status === 'completed';
      if (!resumed) {
        log.warn('closeout_recovery.incomplete', { taskId, status: result.status });
      }
    } catch (err) {
      log.error('closeout_recovery.resume_failed', err, { taskId });
    }
    if (resumed) {
      return;
    }
  }

  // Failure path: move to error-items for THIS taskId only.
  // MUST NOT iterate pidMap or call stopAll — peer children are still live.
  try {
    await moveFailedItemToErrorItems({ repoRoot, taskId });
  } catch (err) {
    log.error('error_items.move_failed', err, { taskId });
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
    void child.exit
      .then((code) => {
        void handleChildExit(taskId, repoRoot, code ?? null, null);
      })
      .catch((err: unknown) => {
        log.error('pipeline.child.exit.failed', err, { taskId });
        void handleChildExit(taskId, repoRoot, 1, null);
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
  options?: { cleanupOwner?: 'caller' | 'child-exit-handler' },
): Promise<
  | { status: 'not-running' }
  | { status: 'stopped-graceful' }
  | { status: 'stopped-forced' }
  | { status: 'unproven-stopped' }
> {
  let entry = pidMap.get(taskId);
  if (!entry) {
    const starting = startingMap.get(taskId);
    if (starting) {
      const started = await Promise.race([
        starting.then(() => 'started' as const).catch(() => 'failed' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), stopGracePeriodMs)),
      ]);
      if (started === 'timeout') return { status: 'unproven-stopped' };
      entry = pidMap.get(taskId);
    }
  }
  if (!entry) return { status: 'not-running' };
  if (options?.cleanupOwner) {
    entry.cleanupOwner = options.cleanupOwner;
  }

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
    const killed = await Promise.race([
      entry.exitPromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), stopGracePeriodMs)),
    ]);
    if (killed === 'timeout') return { status: 'unproven-stopped' };
    pidMap.delete(taskId);
    return { status: 'stopped-forced' };
  }

  pidMap.delete(taskId);
  return { status: 'stopped-graceful' };
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
  const queuePaths = resolveQueuePaths(repoRoot);
  await sweepActivationProgressMarkers({
    paths: queuePaths,
    repoRoot,
    reason: 'startup-recovery',
  });
  const { sweepStaleKillRequests } = await import('../queue/killTask.js');
  await sweepStaleKillRequests({
    paths: queuePaths,
    repoRoot,
    reason: 'startup-recovery',
  });

  // ── Orphan-branch sweep ──────────────────────────────────────────────────
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

  // Read .active-items/ once; partition into markers (non-sentinel entries)
  // and the completing-sentinel set used by the carveout below.
  let activeItemsEntries: string[] = [];
  try {
    activeItemsEntries = await readdir(activeItemsDir);
  } catch { /* absent */ }
  const activeMarkerTaskIds = activeItemsEntries.filter((f) => !f.endsWith('.completing'));
  const activeMarkerSet = new Set(activeMarkerTaskIds);
  const completingSentinelTaskIds = new Set(
    activeItemsEntries
      .filter((f) => f.endsWith('.completing'))
      .map((f) => f.replace(/\.completing$/, '')),
  );

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
    let childChainState: ChildTaskChainsState | undefined;
    let childChainStateUnreadable = false;
    try {
      childChainState = await readChildTaskChains(repoRoot);
    } catch (err) {
      childChainStateUnreadable = true;
      log.warn('startup_recovery.branch_delete.skipped', {
        reason: 'child-chain-state-unreadable',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const branch of taskBranches) {
      const branchTaskId = branch.replace(/^task\//, '');
      // Carveout: keep if any of (a) active marker, (b) pending item, (c) error-items, (d) completing sentinel
      const hasCarveout =
        activeMarkerSet.has(branchTaskId) ||
        pendingItemTaskIds.has(branchTaskId) ||
        errorItemTaskIds.has(branchTaskId) ||
        completingSentinelTaskIds.has(branchTaskId);

      if (!hasCarveout) {
        if (childChainStateUnreadable) {
          log.warn('startup_recovery.branch_delete.skipped', {
            branch,
            taskId: branchTaskId,
            reason: 'child-chain-state-unreadable',
          });
          continue;
        }
        const protectedBranch = await isChildChainSourceBranchProtected({
          repoRoot,
          branch,
          state: childChainState,
        });
        if (protectedBranch.protected) {
          log.progress({
            level: 'warn',
            event: 'startup_recovery.branch_delete.skipped_child_chain',
            extra: {
              branch,
              taskId: branchTaskId,
              reason: 'child-chain-source-branch',
            },
            text: `[startup] preserved child-chain branch ${branch}`,
          });
          continue;
        }
        if (existsSync(path.join(activeItemsDir, branchTaskId))) {
          log.warn('startup_recovery.branch_delete.skipped', {
            branch,
            taskId: branchTaskId,
            reason: 'task-became-active',
          });
          continue;
        }
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
  for (const markerTaskId of activeMarkerTaskIds) {
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

    // Classify outcome via sentinel: the `.completing` sentinel is the durable
    // progress record, while pipeline receipts are forensic-only. Any task
    // whose sentinel exists (step 1 written) but is not yet unlinked (step 5)
    // is a resume candidate; `resumeCloseoutFromSentinel` further gates on
    // `archiveSucceeded === true`.
    const sentinelPath = path.join(activeItemsDir, `${markerTaskId}.completing`);
    let outcome: 'completed' | 'failed' = existsSync(sentinelPath) ? 'completed' : 'failed';

    // 3b: Missing .task.json branch
    const taskJsonPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', markerTaskId, '.task.json');
    if (!existsSync(taskJsonPath)) {
      // Override to failed regardless of sentinel presence
      outcome = 'failed';
      log.info('task_crash.recovered', { taskId: markerTaskId, reason: 'missing-task-json', reclassifiedAs: 'failed' });

      // Skip archival and finalizeTaskWorktrees (no bindings to tear down)
      // Proceed to step 3e+: registry transition handled by moveFailedItemToErrorItems
      try {
        await moveFailedItemToErrorItems({ repoRoot, taskId: markerTaskId });
      } catch (err) {
        log.error('startup.recovery.error.items.move.failed', err, {
          taskId: markerTaskId,
          reason: 'missing-task-json',
        });
      }

      // 3g: Remove marker
      try { unlinkSync(path.join(activeItemsDir, markerTaskId)); } catch { /* best-effort */ }
      // 3h: Remove sentinel
      try { unlinkSync(sentinelPath); } catch { /* best-effort ENOENT */ }
      continue;
    }

    // 3c: If sentinel says "completed", re-drive the closeout via
    // recoverStuckMidCompletion. That call invokes completePendingItem with
    // skipArchive:true, which itself runs finalizeTaskWorktrees + unlinks the
    // marker + unlinks the sentinel as steps 3-5 of the five-step sequence,
    // and removes the pending file, transitions the registry, and (if needed)
    // syncs the retrospective counter. Do NOT call finalizeTaskWorktrees or
    // unlink anything here when recovery succeeded — that would double-finalize.
    if (outcome === 'completed') {
      let recoveredViaCompletion = false;
      try {
        const resumeResult = await resumeCloseoutFromSentinel(markerTaskId, repoRoot);
        recoveredViaCompletion = resumeResult.status === 'completed';
        if (!recoveredViaCompletion) {
          const result = await recoverStuckMidCompletion({ taskId: markerTaskId, repoRoot });
          recoveredViaCompletion = result.recovered;
        }
        if (!recoveredViaCompletion) {
          log.warn('startup_recovery.completion_unproven', { taskId: markerTaskId });
          outcome = 'failed';
        }
      } catch (err) {
        log.error('startup_recovery.completion_failed', err, { taskId: markerTaskId });
        outcome = 'failed';
      }
      if (recoveredViaCompletion) {
        log.info('task_crash.recovered', { taskId: markerTaskId, reason: 'pid-gone', reclassifiedAs: 'completed' });
        continue;
      }
    }

    // 3d: Invoke finalizeTaskWorktrees (MANDATORY unless step 3b fired or 3c recovered)
    try {
      await finalizeTaskWorktrees(markerTaskId, outcome, repoRoot);
    } catch (err) {
      log.error('worktree_finalize.failed', err, { taskId: markerTaskId });
    }

    // 3e: Transition registry + handle failure case
    if (outcome === 'failed') {
      try {
        await moveFailedItemToErrorItems({ repoRoot, taskId: markerTaskId });
      } catch (err) {
        log.error('startup.recovery.error.items.move.failed', err, {
          taskId: markerTaskId,
          reason: 'pid-gone',
          outcome,
        });
      }
    }

    // 3f: Emit task-crash-recovered
    log.info('task_crash.recovered', { taskId: markerTaskId, reason: 'pid-gone', reclassifiedAs: outcome });

    // 3g: Remove marker
    try { unlinkSync(path.join(activeItemsDir, markerTaskId)); } catch { /* best-effort */ }
    // 3h: Remove sentinel
    try { unlinkSync(sentinelPath); } catch { /* best-effort ENOENT */ }
  }

  // ── Step 4: Orphan sweep ─────────────────────────────────────────────────
  // Clean up orphan .completing sentinels with no sibling marker.

  // 4a: Remove orphan .completing sentinels with no sibling marker
  try {
    const sentinelEntries = (await readdir(activeItemsDir)).filter((f) => f.endsWith('.completing'));
    for (const sentinel of sentinelEntries) {
      const siblingTaskId = sentinel.replace(/\.completing$/, '');
      const siblingMarker = path.join(activeItemsDir, siblingTaskId);
      if (!existsSync(siblingMarker)) {
        const result = await resumeCloseoutFromSentinel(siblingTaskId, repoRoot);
        if (result.status !== 'completed') {
          try { unlinkSync(path.join(activeItemsDir, sentinel)); } catch { /* best-effort */ }
        }
      }
    }
  } catch { /* absent */ }

  // ── Step 4c: F35 sentinel-driven runtime-GC sweep ────────────────────────
  // §6.2B: reclaim `.platform-state/runtime/tasks/<id>/` subtrees whose
  // `.gc-after-ts` epoch has passed. A crashed-before-timer session orphans the
  // dir; this sweep is the authoritative restart-side reclaim.
  try {
    sweepRuntimeGC(repoRoot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('runtime_gc.sweep.failed', err, { error: msg });
  }

  // ── Step 5: F36 assertion — lock map MUST be empty ───────────────────────
  // The pidMap starts empty (module-scope initialization) and remains empty
  // after recovery — in-flight operations cannot survive a process restart.
  // No reconstruction is attempted (per F36 spec).
  // Assertion: pidMap.size === 0 at end of recoverOnStartup.
  if (pidMap.size !== 0) {
    log.error('startup_recovery.pid_map_not_empty', { pidMapSize: pidMap.size });
  }
}
