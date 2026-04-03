import path from 'node:path';
import { runPython } from '../core/index.js';
import type { PythonResult } from '../core/index.js';
import type { PythonHelperOptions } from './types.js';

/**
 * Resolve the absolute path to a Python script under src/backend/scripts/python/.
 */
function scriptPath(repoRoot: string, scriptName: string): string {
  return path.join(repoRoot, 'src', 'backend', 'scripts', 'python', scriptName);
}

/**
 * Bootstrap a context pack structure and manifest.
 * Calls src/backend/scripts/python/bootstrap-context-pack.py.
 */
export async function bootstrapContextPack(
  options: PythonHelperOptions & {
    answersFile?: string;
    bootstrapRepoRoot?: string;
  },
): Promise<PythonResult> {
  const { repoRoot, contextPackDir, answersFile, bootstrapRepoRoot } = options;
  const args = ['--context-pack-dir', contextPackDir];

  if (answersFile) {
    args.push('--answers-file', answersFile);
  }
  if (bootstrapRepoRoot) {
    args.push('--repo-root', bootstrapRepoRoot);
  }

  return runPython(scriptPath(repoRoot, 'bootstrap-context-pack.py'), args, {
    cwd: repoRoot,
  });
}

/**
 * Discover the context estate for a context pack.
 * Calls src/backend/scripts/python/discover-context-estate.py.
 */
export async function discoverContextEstate(
  options: PythonHelperOptions,
): Promise<PythonResult> {
  const { repoRoot, contextPackDir } = options;
  const args = ['--context-pack-dir', contextPackDir];

  return runPython(
    scriptPath(repoRoot, 'discover-context-estate.py'),
    args,
    { cwd: repoRoot },
  );
}

/**
 * Plan QMD seeding for a context pack.
 * Calls src/backend/scripts/python/plan-qmd-seeding.py.
 */
export async function planQmdSeeding(
  options: PythonHelperOptions & {
    manifestPath?: string;
    planFile?: string;
    writePlan?: boolean;
    quiet?: boolean;
  },
): Promise<PythonResult> {
  const { repoRoot, contextPackDir, manifestPath, planFile, writePlan, quiet } =
    options;
  const args = ['--context-pack-dir', contextPackDir];

  if (manifestPath) {
    args.push('--manifest', manifestPath);
  }
  if (planFile) {
    args.push('--plan-file', planFile);
  }
  if (writePlan) {
    args.push('--write-plan');
  }
  if (quiet) {
    args.push('--quiet');
  }

  return runPython(scriptPath(repoRoot, 'plan-qmd-seeding.py'), args, {
    cwd: repoRoot,
  });
}

/**
 * Sync context pack workspace folders via the Python helper.
 * Calls src/backend/scripts/python/sync-context-pack-workspace.py.
 */
export async function syncContextPackWorkspace(
  options: PythonHelperOptions & {
    action: string;
    workspaceRoot?: string;
    workspaceFile?: string;
    stateFile?: string;
    scopeMode?: string;
    format?: string;
  },
): Promise<PythonResult> {
  const { repoRoot, contextPackDir, action, workspaceRoot, workspaceFile, stateFile, scopeMode, format } =
    options;
  const args = ['--action', action];

  if (contextPackDir) {
    args.push('--context-pack-dir', contextPackDir);
  }
  if (workspaceRoot) {
    args.push('--workspace-root', workspaceRoot);
  }
  if (workspaceFile) {
    args.push('--workspace-file', workspaceFile);
  }
  if (stateFile) {
    args.push('--state-file', stateFile);
  }
  if (scopeMode) {
    args.push('--scope-mode', scopeMode);
  }
  if (format) {
    args.push('--format', format);
  }

  return runPython(
    scriptPath(repoRoot, 'sync-context-pack-workspace.py'),
    args,
    { cwd: repoRoot },
  );
}

/**
 * Call the activate-context-pack-helper.py Python script.
 * Calls src/backend/scripts/python/activate-context-pack-helper.py.
 */
export async function activateContextPackHelper(
  options: PythonHelperOptions & {
    subcommand: string;
    extraArgs?: string[];
  },
): Promise<PythonResult> {
  const { repoRoot, subcommand, extraArgs = [] } = options;
  const args = [subcommand, ...extraArgs];

  return runPython(
    scriptPath(repoRoot, 'activate-context-pack-helper.py'),
    args,
    { cwd: repoRoot },
  );
}
