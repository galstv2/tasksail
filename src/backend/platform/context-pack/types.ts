/** Options for the activate-context-pack command. */
export type RepositoryType = 'primary' | 'support';

/** Options for the activate-context-pack command. */
export interface ActivateOptions {
  /** Absolute or repo-relative path to the context pack directory. */
  contextPackDir: string;
  /** Optional repo root for bootstrap mode. */
  bootstrapRepoRoot?: string;
  /** If true, print what would happen without writing. */
  dryRun?: boolean;
}

/** Mode for workspace switching. */
export type SwitchMode = 'preview' | 'apply' | 'clear';

/** Options for the switch-context-pack-workspace command. */
export interface SwitchOptions {
  /** Path to the context pack directory. */
  contextPackDir: string;
  /** Switch mode: preview, apply, or clear. */
  mode: SwitchMode;
}

/** Result of pack structure validation. */
export interface ValidationResult {
  /** True if the pack structure is valid (no errors). */
  valid: boolean;
  /** Validation errors (fatal). */
  errors: string[];
  /** Validation warnings (non-fatal). */
  warnings: string[];
}

/** Result of workspace preview. */
export interface WorkspacePreview {
  /** Folders that would be added to the workspace. */
  add: string[];
  /** Folders that would be removed from the workspace. */
  remove: string[];
}

/** Options for Python helper invocations. */
export interface PythonHelperOptions {
  /** Repository root directory. */
  repoRoot: string;
  /** Path to the context pack directory. */
  contextPackDir: string;
  /** Additional options passed to specific helpers. */
  [key: string]: unknown;
}


/**
 * Configured in a context pack's `taskMaterialization` field.
 * Controls which directories are CoW-cloned into each worktree at activation.
 */
export interface TaskMaterializationConfig {
  paths: string[];
  strategy: 'clone-or-copy';
}

/**
 * Default set of dependency directories materialized into each worktree.
 * All paths MUST be relative (validated by resolveTaskMaterializationConfig).
 */
export const DEFAULT_TASK_MATERIALIZATION_PATHS: readonly string[] = [
  'node_modules',
  '.venv',
  'target',
  'dist',
  '.next',
  'build',
];

/**
 * Validate and resolve raw context-pack `taskMaterialization` config.
 *
 * Rules:
 *   - `paths` items must be relative (no leading `/`). Throws on violation.
 *   - Missing or null field → returns default paths with strategy 'clone-or-copy'.
 */
export function resolveTaskMaterializationConfig(raw: unknown): TaskMaterializationConfig {
  if (raw === undefined || raw === null) {
    return { paths: [...DEFAULT_TASK_MATERIALIZATION_PATHS], strategy: 'clone-or-copy' };
  }

  const obj = raw as Record<string, unknown>;

  const rawPaths = obj['paths'];
  if (rawPaths === undefined || rawPaths === null) {
    return { paths: [...DEFAULT_TASK_MATERIALIZATION_PATHS], strategy: 'clone-or-copy' };
  }

  if (!Array.isArray(rawPaths)) {
    throw new Error('taskMaterialization.paths must be an array of relative strings');
  }

  const paths: string[] = [];
  for (const p of rawPaths as unknown[]) {
    if (typeof p !== 'string') {
      throw new Error('taskMaterialization.paths must be an array of relative strings');
    }
    if (p.startsWith('/')) {
      throw new Error('taskMaterialization.paths must be relative');
    }
    paths.push(p);
  }

  return { paths, strategy: 'clone-or-copy' };
}
