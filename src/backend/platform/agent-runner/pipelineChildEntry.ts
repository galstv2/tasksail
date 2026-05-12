import { CLOSEOUT_FAILURE_EXIT_CODE, runPipelineSequence } from './pipeline/sequencer.js';
import { pathToFileURL } from 'node:url';

/**
 * Pipeline child entrypoint. Invoked by spawnPipelineForTask via child_process.fork.
 *
 * Argv parsing:
 *   --task-id <id>     The task identifier for this pipeline run.
 *   --repo-root <path> The repo root (falls back to process.cwd() if absent).
 *
 * Env-vs-argv precedence (spec §5.1 lines 79-84):
 *   1. If --task-id is present in argv: use that. Assert TASKSAIL_TASK_ID either
 *      matches or is absent. Mismatch => throw conflicting-task-id-arg-vs-env.
 *   2. If --task-id is absent but TASKSAIL_TASK_ID env is set: use env.
 *   3. Neither => throw task-id-required.
 *
 * argv wins because argv is the explicit, call-site-owned channel; env is ambient
 * and can be inherited accidentally across fork boundaries.
 */

function parseArgv(argv: string[]): { taskId: string | undefined; repoRoot: string | undefined } {
  let taskId: string | undefined;
  let repoRoot: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task-id' && i + 1 < argv.length) {
      taskId = argv[++i];
    } else if (argv[i] === '--repo-root' && i + 1 < argv.length) {
      repoRoot = argv[++i];
    }
  }

  return { taskId, repoRoot };
}

const CONFINEMENT_BOUNDARY_FAILURE_SIGNAL = 'Dalton edited files outside the enforced writable roots';

export function formatPipelineChildEntryError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes(CONFINEMENT_BOUNDARY_FAILURE_SIGNAL)) {
    return [
      '[pipelineChildEntry] Confinement blocked task safely: Dalton changed files outside the selected writable scope.',
      '[pipelineChildEntry] Review the Dalton guardrail receipt for the affected paths.',
    ].join('\n') + '\n';
  }
  return `[pipelineChildEntry] Fatal error: ${message}\n`;
}

async function main(): Promise<void> {
  const { taskId: argvTaskId, repoRoot: argvRepoRoot } = parseArgv(process.argv);
  const envTaskId = process.env['TASKSAIL_TASK_ID'];

  // Resolve taskId with precedence: argv > env
  let resolvedTaskId: string;
  if (argvTaskId !== undefined) {
    // argv present — use it, but assert env consistency when env is also set
    if (envTaskId !== undefined && envTaskId !== argvTaskId) {
      throw new Error(
        `conflicting-task-id-arg-vs-env: argv=${argvTaskId} env=${envTaskId}`,
      );
    }
    resolvedTaskId = argvTaskId;
  } else if (envTaskId !== undefined) {
    // env fallback — for test harnesses invoking the entry directly without argv rewiring
    resolvedTaskId = envTaskId;
  } else {
    throw new Error('task-id-required');
  }

  // Resolve repoRoot: argv wins; fall back to cwd
  const resolvedRepoRoot = argvRepoRoot ?? process.cwd();

  const receipt = await runPipelineSequence({
    taskId: resolvedTaskId,
    repoRoot: resolvedRepoRoot,
  });

  // Map pipeline receipt status to exit code
  const exitCode = receipt.status === 'completed' ? 0 : 1;
  process.exit(exitCode);
}

function isDirectEntryPoint(): boolean {
  const entryPath = process.argv[1];
  return entryPath ? import.meta.url === pathToFileURL(entryPath).href : false;
}

if (isDirectEntryPoint()) {
  main().catch((err: unknown) => {
    process.stderr.write(formatPipelineChildEntryError(err));
    const isCloseoutFailure = (err as { _isCloseoutFailure?: boolean })?._isCloseoutFailure === true;
    process.exit(isCloseoutFailure ? CLOSEOUT_FAILURE_EXIT_CODE : 1);
  });
}
