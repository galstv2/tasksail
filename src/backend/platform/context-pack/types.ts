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
