/**
 * Minimal fork-able stub that replicates pipelineChildEntry.ts's arg-parsing
 * and env-vs-argv precedence logic. Used by spawnPipeline.test.ts.
 *
 * Instead of calling runPipelineSequence, it:
 *   - Validates arg/env precedence (throws on conflict or missing)
 *   - Writes a JSON receipt to the path given via STUB_RECEIPT_PATH env var (if set)
 *   - Exits 0 on success, 1 on error
 *
 * This is plain CJS so it can be forked without tsx.
 */
'use strict';

function parseArgv(argv) {
  let taskId;
  let repoRoot;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task-id' && i + 1 < argv.length) {
      taskId = argv[++i];
    } else if (argv[i] === '--repo-root' && i + 1 < argv.length) {
      repoRoot = argv[++i];
    }
  }
  return { taskId, repoRoot };
}

async function main() {
  const { taskId: argvTaskId, repoRoot: argvRepoRoot } = parseArgv(process.argv);
  const envTaskId = process.env['TASKSAIL_TASK_ID'];

  let resolvedTaskId;
  if (argvTaskId !== undefined) {
    if (envTaskId !== undefined && envTaskId !== argvTaskId) {
      throw new Error(`conflicting-task-id-arg-vs-env: argv=${argvTaskId} env=${envTaskId}`);
    }
    resolvedTaskId = argvTaskId;
  } else if (envTaskId !== undefined) {
    resolvedTaskId = envTaskId;
  } else {
    throw new Error('task-id-required');
  }

  const resolvedRepoRoot = argvRepoRoot ?? process.cwd();

  // Simulate a brief pipeline run (25ms) to prove concurrent execution works
  await new Promise((resolve) => setTimeout(resolve, 25));

  const receiptPath = process.env['STUB_RECEIPT_PATH'];
  if (receiptPath) {
    const fs = require('node:fs');
    const os = require('node:os');
    fs.writeFileSync(receiptPath, JSON.stringify({
      taskId: resolvedTaskId,
      repoRoot: resolvedRepoRoot,
      pid: process.pid,
      ts: Date.now(),
    }) + os.EOL, 'utf-8');
  }

  // Emit a line to stdout so F13 stream test can receive it
  process.stdout.write(`pipeline-stub-ok:${resolvedTaskId}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[pipelineChildStub] Fatal: ${err.message}\n`);
  process.exit(1);
});
