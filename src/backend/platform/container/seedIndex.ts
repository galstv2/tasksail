import path from 'node:path';
import { runPython } from '../core/index.js';
import type { SeedOptions } from './types.js';

/**
 * Invoke the QMD seeding executor via the Python repo-context-app.py script.
 */
export async function seedIndex(options: SeedOptions): Promise<void> {
  const {
    repoRoot,
    contextPackDir,
    manifest = 'qmd/repo-sources.json',
    planFile = 'qmd/bootstrap/seed-plan.json',
    planMode = 'prefer-plan',
    writePlan = true,
  } = options;

  if (!contextPackDir) {
    throw new Error(
      'Active context pack directory is required. Set ACTIVE_CONTEXT_PACK_DIR or pass contextPackDir.',
    );
  }

  const scriptPath = path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'repo-context-app.py');

  const args: string[] = [
    'seed',
    '--context-pack-dir',
    contextPackDir,
    '--manifest',
    manifest,
    '--plan-file',
    planFile,
    '--plan-mode',
    planMode,
    '--format',
    'markdown',
  ];

  if (!writePlan) {
    args.push('--no-write-report');
  }

  await runPython(scriptPath, args, { cwd: repoRoot });
}
