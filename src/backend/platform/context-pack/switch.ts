import path from 'node:path';
import {
  findRepoRoot,
  resolvePath,
  runPython,
  safeJsonParse,
} from '../core/index.js';
import type {
  SwitchMode,
  SwitchOptions,
  WorkspacePreview,
} from './types.js';
import { setActiveContextPackEnv } from './activate.js';

/** Default workspace file name relative to workspace root. */
const DEFAULT_WORKSPACE_FILE = 'tasksail.code-workspace';

/** Default state file path relative to workspace root. */
const DEFAULT_STATE_FILE = '.platform-state/workspace-context-sync.json';

/**
 * Build arguments for the Python sync-context-pack-workspace.py script.
 */
function buildSyncArgs(
  action: string,
  workspaceRoot: string,
  contextPackDir?: string,
): string[] {
  const args = [
    '--action', action,
    '--workspace-root', workspaceRoot,
    '--workspace-file', DEFAULT_WORKSPACE_FILE,
    '--state-file', DEFAULT_STATE_FILE,
    '--scope-mode', 'focused',
    '--format', 'json',
  ];
  if (contextPackDir) {
    args.push('--context-pack-dir', contextPackDir);
  }
  return args;
}

/**
 * Preview what workspace folder changes would occur without applying them.
 * Returns a WorkspacePreview with add/remove lists.
 */
export async function previewWorkspaceChanges(
  contextPackDir: string,
): Promise<WorkspacePreview> {
  const repoRoot = findRepoRoot();
  const resolvedDir = resolvePath(repoRoot, contextPackDir);
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'sync-context-pack-workspace.py',
  );

  const args = buildSyncArgs('preview', repoRoot, resolvedDir);
  const result = await runPython(scriptPath, args, { cwd: repoRoot });

  const parsed = safeJsonParse<WorkspacePreview>(result.stdout, 'sync-context-pack-workspace stdout');
  return parsed;
}

/**
 * Apply workspace folder changes for a context pack.
 * Activates the context pack first, then syncs workspace folders.
 */
export async function applyWorkspaceFolders(
  contextPackDir: string,
): Promise<string> {
  const repoRoot = findRepoRoot();
  const resolvedDir = resolvePath(repoRoot, contextPackDir);
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'sync-context-pack-workspace.py',
  );

  const args = buildSyncArgs('apply', repoRoot, resolvedDir);
  const result = await runPython(scriptPath, args, { cwd: repoRoot });

  await setActiveContextPackEnv(repoRoot, resolvedDir);

  return result.stdout;
}

/**
 * Clear managed workspace folder entries and reset active context pack state.
 */
export async function clearWorkspaceFolders(): Promise<string> {
  const repoRoot = findRepoRoot();
  const scriptPath = path.join(
    repoRoot,
    'src', 'backend', 'scripts',
    'python',
    'sync-context-pack-workspace.py',
  );

  const args = buildSyncArgs('clear', repoRoot);
  const result = await runPython(scriptPath, args, { cwd: repoRoot });

  await setActiveContextPackEnv(repoRoot, '');

  return result.stdout;
}

/**
 * Dispatch to the appropriate workspace operation based on switch mode.
 */
export async function switchContextPackWorkspace(
  options: SwitchOptions,
): Promise<{ mode: SwitchMode; output: string }> {
  switch (options.mode) {
    case 'preview': {
      const preview = await previewWorkspaceChanges(options.contextPackDir);
      return { mode: 'preview', output: JSON.stringify(preview, null, 2) };
    }
    case 'apply': {
      const output = await applyWorkspaceFolders(options.contextPackDir);
      return { mode: 'apply', output };
    }
    case 'clear': {
      const output = await clearWorkspaceFolders();
      return { mode: 'clear', output };
    }
  }
}
