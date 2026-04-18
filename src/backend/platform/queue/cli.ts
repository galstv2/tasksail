import { createDropboxTask } from './createDropboxTask.js';
import { createFollowupTask } from './createFollowupTask.js';
import { initializeTask } from './newTask.js';
import { getQueueStatus } from './queueStatus.js';
import { completePendingItem } from './completePendingItem.js';
import { pollDropbox } from './pollDropbox.js';
import { repairQueue } from './repairQueue.js';
import {
  moveDropboxItemsOnce,
  activateNextPendingItemIfReady,
  acquireDirLockOrThrow,
} from './operations.js';
import { resolveQueuePaths } from './paths.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/active.js';

const USAGE = `Usage: task-queue <command> [options]

Commands:
  create-task                  Create a queue-ready markdown task file in dropbox/
  followup                     Create a child-task follow-up draft
  init                         Initialize or reset the handoff workspace
  status                       Show current queue state
  complete                     Complete the active pending item
  poll                         Watch dropbox for new task files
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

  switch (command) {
    case 'create-task': {
      const outputPath = await createDropboxTask({
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
        repoRoot: flags['repo-root'],
      });
      process.stdout.write(`Created dropbox task: ${outputPath}\n`);
      break;
    }

    case 'followup': {
      const outputPath = await createFollowupTask({
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
        repoRoot: flags['repo-root'],
      });
      process.stdout.write(`Created follow-up task: ${outputPath}\n`);
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
      const status = await getQueueStatus(flags['repo-root']);
      process.stdout.write(`Workspace Ready: ${status.workspaceReady ? 'yes' : 'no'}\n`);
      process.stdout.write(`Active Item: ${status.activeItem ?? 'none'}\n`);
      if (status.activeItemWithBlankWorkspace) {
        process.stdout.write(
          'WARNING: .active-item present but handoffs/ is blank — run "task-queue repair --auto-fix" to recover\n',
        );
      }
      if (status.partialPublish) {
        process.stdout.write(
          'WARNING: handoff publish was interrupted — run "task-queue repair --auto-fix" to recover\n',
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
      await completePendingItem({
        skipValidation: booleans.has('skip-validation') || booleans.has('force'),
        skipArchive: booleans.has('skip-archive'),
        repoRoot: flags['repo-root'],
      });
      process.stdout.write('Completed active pending item.\n');
      break;
    }

    case 'poll': {
      let interval: number | undefined;
      if (flags['interval']) {
        interval = parseInt(flags['interval'], 10);
        if (Number.isNaN(interval) || interval <= 0) {
          process.stderr.write(
            `Error: --interval must be a positive integer, got "${flags['interval']}"\n`,
          );
          process.exitCode = 1;
          return;
        }
      }
      const rawWatchMode = flags['watch-mode'];
      if (rawWatchMode !== undefined && rawWatchMode !== 'auto' && rawWatchMode !== 'poll') {
        process.stderr.write(`Error: --watch-mode must be "auto" or "poll", got "${rawWatchMode}"\n`);
        process.exitCode = 1;
        return;
      }
      const watchMode = rawWatchMode as 'auto' | 'poll' | undefined;
      await pollDropbox({ interval, watchMode, repoRoot: flags['repo-root'] });
      break;
    }

    case 'repair': {
      const repairAutoFix = booleans.has('auto-fix');
      const repairPaths = resolveQueuePaths(flags['repo-root']);

      // When auto-fixing, hold the queue lock to prevent races with live operations
      let repairRelease: (() => Promise<void>) | null = null;
      if (repairAutoFix && !booleans.has('dry-run')) {
        repairRelease = await acquireDirLockOrThrow(
          repairPaths.queueLockDir,
          'repair --auto-fix',
        );
      }

      try {
        const result = await repairQueue({
          dryRun: booleans.has('dry-run'),
          autoFix: repairAutoFix,
          repoRoot: flags['repo-root'],
        });

        if (result.issues.length === 0) {
          process.stdout.write('Queue state is consistent. No issues detected.\n');
        } else {
          for (const issue of result.issues) {
            process.stdout.write(`ISSUE: ${issue}\n`);
          }
          for (const fix of result.fixed) {
            process.stdout.write(`FIXED: ${fix}\n`);
          }
        }
      } finally {
        if (repairRelease) {
          await repairRelease();
        }
      }
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
      const qp2 = resolveQueuePaths(flags['repo-root']);
      // §3.2: resolve context pack via the policy layer (reads sidecar when
      // TASKSAIL_TASK_ID is set, else falls back to singleton). Best-effort.
      let activateContextPackDir: string | undefined;
      try {
        activateContextPackDir = await requireAuthorizedActiveContextPack({
          repoRoot: flags['repo-root'],
        });
      } catch {
        activateContextPackDir = undefined;
      }
      const release2 = await acquireDirLockOrThrow(
        qp2.queueLockDir,
        'activate-next-pending-item',
      );
      try {
        const activated = await activateNextPendingItemIfReady(
          qp2.pendingDir,
          qp2.handoffsDir,
          qp2.templatesDir,
          activateContextPackDir,
        );
        if (!activated) {
          process.stdout.write('waiting until handoffs/ is reset or pending items are available\n');
          process.exitCode = 2;
        } else {
          process.stdout.write('Activated next pending item.\n');
        }
      } finally {
        await release2();
      }
      break;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      process.stdout.write(USAGE);
      process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
