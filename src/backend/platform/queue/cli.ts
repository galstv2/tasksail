import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readdir, rmdir, stat } from 'node:fs/promises';
import { createDropboxTask } from './createDropboxTask.js';
import { createFollowupTask } from './createFollowupTask.js';
import { initializeTask } from './newTask.js';
import { getQueueStatus } from './queueStatus.js';
import { getCloseoutHealth } from './closeoutHealth.js';
import { completePendingItem } from './completePendingItem.js';
import { publishPendingItem } from './publishPendingItem.js';
import { repairQueue } from './repairQueue.js';
import { recoverStuckMidCompletion } from './recoverStuckMidCompletion.js';
import {
  moveDropboxItemsOnce,
  activateNextPendingItemIfReady,
  acquireDirLockOrThrow,
  getActiveTaskIds,
} from './operations.js';
import { resolveQueuePaths } from './paths.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/active.js';
import { findRepoRoot } from '../core/index.js';
import type { QueueRepairIssue } from './repairQueueIssues.js';

const USAGE = `Usage: task-queue <command> [options]

Commands:
  create-task                  Create a queue-ready markdown task file in dropbox/
  followup                     Create a child-task follow-up draft
  init                         Initialize or reset the handoff workspace
  status                       Show current queue state
  complete                     Complete the active pending item
  repair                       Detect and fix inconsistent queue state
  move-dropbox-items           Move .md files from dropbox/ to pendingitems/
  activate-next-pending-item   Activate the next pending item if workspace is ready

Global options:
  --repo-root <path>           Override repo root for path resolution
`;

/**
 * Parse CLI arguments into a command and key-value flags.
 */
function parseArgs(argv: string[]): {
  command: string;
  flags: Record<string, string>;
  booleans: Set<string>;
} {
  const command = argv[0] ?? '';
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        booleans.add(key);
      }
    }
  }

  return { command, flags, booleans };
}

export async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    return;
  }

  const { command, flags, booleans } = parseArgs(argv);
  const repoRoot = flags['repo-root'] ?? findRepoRoot();

  switch (command) {
    case 'create-task': {
      let contextPackDir: string | undefined;
      try {
        contextPackDir = await requireAuthorizedActiveContextPack({ repoRoot });
      } catch {
        contextPackDir = undefined;
      }
      const { destinationPath: outputPath, activation } = await publishPendingItem({
        publish: () =>
          createDropboxTask({
            title: flags['title'] ?? '',
            summary: flags['summary'],
            desiredOutcome: flags['desired-outcome'],
            constraints: flags['constraints'],
            acceptanceSignals: flags['acceptance-signals'],
            suggestedPath: flags['suggested-path'],
            planningNotes: flags['planning-notes'],
            kind: flags['kind'],
            outputPath: flags['output'],
            force: booleans.has('force'),
            parentTaskId: flags['parent-task-id'],
            parentQmdRecordId: flags['parent-qmd-record-id'],
            parentQmdScope: flags['parent-qmd-scope'],
            rootTaskId: flags['root-task-id'],
            followupReason: flags['followup-reason'],
            carryForwardSummary: flags['carry-forward-summary'],
            contextPackDir,
            repoRoot,
          }),
        repoRoot,
        contextPackDir,
        lockOperationName: 'cli.new-task.dropbox',
      });
      process.stdout.write(`Created dropbox task: ${outputPath}\n`);
      if (activation.activated) {
        process.stdout.write(`[cli.new-task] activated next pending item after publish.\n`);
      } else if (activation.reason) {
        process.stdout.write(`[cli.new-task] activation skipped after publish: ${activation.reason}\n`);
      }
      break;
    }

    case 'followup': {
      let contextPackDir: string | undefined;
      try {
        contextPackDir = await requireAuthorizedActiveContextPack({ repoRoot });
      } catch {
        contextPackDir = undefined;
      }
      const { destinationPath: outputPath, activation } = await publishPendingItem({
        publish: () =>
          createFollowupTask({
            title: flags['title'] ?? '',
            summary: flags['summary'],
            desiredOutcome: flags['desired-outcome'],
            constraints: flags['constraints'],
            acceptanceSignals: flags['acceptance-signals'],
            parentTaskId: flags['parent-task-id'] ?? '',
            parentQmdScope: flags['parent-qmd-scope'] ?? '',
            parentQmdRecordId: flags['parent-qmd-record-id'],
            rootTaskId: flags['root-task-id'],
            followupReason: flags['followup-reason'] ?? '',
            carryForwardSummary: flags['carry-forward-summary'] ?? '',
            suggestedPath: flags['suggested-path'],
            planningNotes: flags['planning-notes'],
            outputPath: flags['output'],
            force: booleans.has('force'),
            contextPackDir,
            repoRoot,
          }),
        repoRoot,
        contextPackDir,
        lockOperationName: 'cli.new-task.followup',
      });
      process.stdout.write(`Created follow-up task: ${outputPath}\n`);
      if (activation.activated) {
        process.stdout.write(`[cli.new-task] activated next pending item after publish.\n`);
      } else if (activation.reason) {
        process.stdout.write(`[cli.new-task] activation skipped after publish: ${activation.reason}\n`);
      }
      break;
    }

    case 'init': {
      await initializeTask({
        title: flags['title'],
        taskId: flags['task-id'],
        source: flags['source'],
        rawRequest: flags['raw-request'],
        withStarterSlice: booleans.has('with-starter-slice'),
        reset: booleans.has('reset'),
        force: booleans.has('force'),
        repoRoot: flags['repo-root'],
      });
      if (booleans.has('reset')) {
        process.stdout.write('Cleared handoff artifacts.\n');
      } else {
        process.stdout.write('Initialized handoff artifacts.\n');
      }
      break;
    }

    case 'status': {
      if (booleans.has('closeout-health')) {
        const health = await getCloseoutHealth(repoRoot);
        process.stdout.write(JSON.stringify(health, null, 2) + '\n');
        break;
      }
      const status = await getQueueStatus(flags['repo-root']);
      process.stdout.write(`Workspace Ready: ${status.workspaceReady ? 'yes' : 'no'}\n`);
      process.stdout.write(`Active Item: ${status.activeTasks[0]?.taskId ?? 'none'}\n`);
      if (status.activeTaskWithBlankWorkspace) {
        process.stdout.write(
          'WARNING: active task marker present but handoffs/ is blank — run "task-queue repair --auto-fix" to recover\n',
        );
      }
      if (status.partialPublish) {
        process.stdout.write(
          'WARNING: handoff publish was interrupted — run "task-queue repair --auto-fix" to recover\n',
        );
      }
      for (const taskId of status.stuckMidCompletion) {
        process.stdout.write(
          `WARNING: task '${taskId}' is stuck mid-completion (closeout died after archive/checkpoint).\n` +
          `         Switching to branch 'task/${taskId}' may fail until recovery runs because stale worktree metadata can pin the branch.\n` +
          `         Recover with: pnpm run repair -- --auto-fix\n`,
        );
      }
      if (status.errorItemsCount > 0) {
        process.stdout.write(`Error Items: ${status.errorItemsCount}\n`);
      }
      process.stdout.write(`Dropbox Items: ${status.dropboxItems.length}\n`);
      for (const item of status.dropboxItems) {
        process.stdout.write(`  ${item}\n`);
      }
      process.stdout.write(`Pending Items: ${status.pendingItems.length}\n`);
      for (const item of status.pendingItems) {
        process.stdout.write(`  ${item}\n`);
      }
      break;
    }

    case 'complete': {
      // §4.3: --task-id is the preferred interface. When omitted and exactly one
      // active task exists, default to that id. When omitted and N>1 active tasks
      // exist, fail fast — never silently pick "first active".
      let completeTaskId = flags['task-id'];
      if (!completeTaskId) {
        const completeRepoRoot = flags['repo-root'];
        const completePaths = resolveQueuePaths(completeRepoRoot);
        const activeIds = getActiveTaskIds(completePaths);
        if (activeIds.length === 1) {
          completeTaskId = activeIds[0]!;
        } else if (activeIds.length === 0) {
          process.stderr.write(
            'Error: no active task found. Activate a task before completing.\n',
          );
          process.exitCode = 1;
          return;
        } else {
          // N>1 active tasks — operator must disambiguate.
          process.stderr.write(
            `Error [completion-requires-task-id]: multiple active tasks found. Pass --task-id to specify which to complete.\nActive task IDs:\n${activeIds.map((id) => `  ${id}`).join('\n')}\n`,
          );
          process.exitCode = 1;
          return;
        }
      }
      await completePendingItem({
        taskId: completeTaskId,
        skipValidation: booleans.has('skip-validation') || booleans.has('force'),
        skipArchive: booleans.has('skip-archive'),
        repoRoot: flags['repo-root'],
      });
      process.stdout.write('Completed active pending item.\n');
      break;
    }

    case 'repair': {
      await runRepairCommand({
        repoRoot: flags['repo-root'],
        autoFix: booleans.has('auto-fix'),
        dryRun: booleans.has('dry-run'),
      });
      break;
    }

    case 'move-dropbox-items': {
      const qp = resolveQueuePaths(flags['repo-root']);
      const release = await acquireDirLockOrThrow(
        qp.queueLockDir,
        'move-dropbox-items',
      );
      try {
        const moved = await moveDropboxItemsOnce(qp.dropboxDir, qp.pendingDir);
        process.stdout.write(`Moved ${moved} item(s) from dropbox to pending.\n`);
      } finally {
        await release();
      }
      break;
    }

    case 'activate-next-pending-item': {
      const qp2 = resolveQueuePaths(repoRoot);

      // §4.2: --task-id flag is the new required interface. When absent AND no
      // tasks are currently active, allow the legacy singleton fallback for
      // backwards-compat with existing tests/operators on pre-parallel flows.
      const taskId = flags['task-id'];

      // §3.2: resolve context pack via the policy layer. Explicit taskId wins;
      // falls back to singleton env path when taskId is absent. Best-effort.
      let activateContextPackDir: string | undefined;
      try {
        if (taskId) {
          activateContextPackDir = await requireAuthorizedActiveContextPack({
            repoRoot: repoRoot,
            taskId,
          });
        } else {
          // Legacy singleton back-compat: only if no tasks are currently active.
          const activeTasks = getActiveTaskIds(qp2);
          if (activeTasks.length === 0) {
            activateContextPackDir = await requireAuthorizedActiveContextPack({
              repoRoot: repoRoot,
            });
          }
        }
      } catch {
        activateContextPackDir = undefined;
      }

      const result = await activateNextPendingItemIfReady({
        paths: qp2,
        repoRoot: repoRoot,
        contextPackDir: activateContextPackDir,
      });
      if (!result.activated) {
        process.stdout.write('waiting until handoffs/ is reset or pending items are available\n');
        process.exitCode = 2;
      } else {
        process.stdout.write('Activated next pending item.\n');
      }
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      process.stdout.write(USAGE);
      process.exitCode = 1;
  }
}

export async function runRepairCommand(options: {
  repoRoot?: string;
  autoFix?: boolean;
  dryRun?: boolean;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
}): Promise<void> {
  const {
    repoRoot,
    autoFix = false,
    dryRun = false,
    stdout = process.stdout,
    stderr = process.stderr,
  } = options;
  const effectiveRepoRoot = repoRoot ?? findRepoRoot();
  const repairPaths = resolveQueuePaths(effectiveRepoRoot);
  let repairRelease: (() => Promise<void>) | null = null;
  let stuckIssues: QueueRepairIssue[] = [];

  try {
    if (autoFix && !dryRun) {
      repairRelease = await acquireDirLockOrThrow(
        repairPaths.queueLockDir,
        'repair --auto-fix',
      );
    }

    const result = await repairQueue({ dryRun, autoFix, repoRoot: effectiveRepoRoot });
    stuckIssues = result.structuredIssues.filter(
      (issue) => issue.kind === 'sentinel-without-completed-marker',
    );

    if (result.issues.length === 0) {
      stdout.write('Queue state is consistent. No issues detected.\n');
    } else {
      for (const issue of result.issues) {
        stdout.write(`ISSUE: ${issue}\n`);
      }
      for (const fix of result.fixed) {
        stdout.write(`FIXED: ${fix}\n`);
      }
    }
  } finally {
    if (repairRelease) {
      await repairRelease();
    }
  }

  if (!autoFix || dryRun) return;

  const taskIds = [...new Set(stuckIssues.map((issue) => issue.taskId))].sort();
  for (const taskId of taskIds) {
    try {
      const result = await recoverStuckMidCompletion({ taskId, repoRoot: effectiveRepoRoot });
      if (result.recovered) {
        stdout.write(`FIXED: re-drove closeout for stuck task '${taskId}'\n`);
      } else {
        stdout.write(
          `SKIPPED: stuck task '${taskId}' was not auto-fixed because archive success is not proven by sentinel or archive records.\n` +
          '         manual recovery requires operator confirmation before using --skip-archive.\n',
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(
        `FAILED: re-drive closeout for '${taskId}' threw: ${message}\n` +
        `        manual recovery: inspect .active-items/${taskId}.completing and rerun repair after fixing the failing closeout step\n`,
      );
    }
  }

  const counterDir = path.join(effectiveRepoRoot, '.platform-state', 'task-counters');
  let counterEntries: string[] = [];
  try {
    counterEntries = await readdir(counterDir);
  } catch {
    // Directory may not exist on a fresh repo — nothing to reclaim.
  }
  const STALE_LOCK_MS = 5 * 60 * 1000;
  for (const entry of counterEntries) {
    if (!entry.endsWith('.lock')) continue;
    const lockPath = path.join(counterDir, entry);
    try {
      const info = await stat(lockPath);
      if (!info.isDirectory()) continue;
      const ageMs = Date.now() - info.mtimeMs;
      if (ageMs > STALE_LOCK_MS) {
        await rmdir(lockPath);
        stdout.write(`FIXED: reclaimed stale counter lock '${entry}' (ageMs=${Math.round(ageMs)})\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stderr.write(`SKIPPED: counter lock '${entry}' could not be reclaimed: ${message}\n`);
    }
  }
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  void main(process.argv.slice(2)).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
