import { runPython, resolvePaths } from '../core/index.js';
import type { PythonResult } from '../core/index.js';
import path from 'node:path';

/**
 * Generate AgentWorkSpace/handoffs/code-changes.diff for QA review.
 */
export async function captureCodeDiff(options: {
  contextPackDir: string;
  outputPath: string;
  repoRoot?: string;
  abortSignal?: AbortSignal;
}): Promise<PythonResult> {
  const paths = resolvePaths(options.repoRoot);
  const helperPath = path.join(
    paths.repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'run-role-agent-helper.py',
  );

  return runPython(
    helperPath,
    [
      'capture-code-diff',
      options.contextPackDir,
      options.outputPath,
      '--repo-root',
      paths.repoRoot,
    ],
    {
      cwd: paths.repoRoot,
      abortSignal: options.abortSignal,
    },
  );
}
