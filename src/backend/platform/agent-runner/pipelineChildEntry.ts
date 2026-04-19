import { runPipelineSequence } from './pipeline/sequencer.js';

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

main().catch((err: unknown) => {
  process.stderr.write(
    `[pipelineChildEntry] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
