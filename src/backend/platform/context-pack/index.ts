export {
  validatePackStructure,
  activateContextPack,
  setActiveContextPackEnv,
  ACTIVE_CONTEXT_PACK_DIR_KEY,
} from './activate.js';

export {
  requireAuthorizedActiveContextPack,
  requireAuthorizedActiveContextPackBinding,
} from './active.js';
export type {
  RequireAuthorizedActiveContextPackOptions,
  TaskContextPackBindingFromSidecar,
} from './active.js';

export {
  previewWorkspaceChanges,
  applyWorkspaceFolders,
  clearWorkspaceFolders,
  switchContextPackWorkspace,
} from './switch.js';

export {
  bootstrapContextPack,
  discoverContextEstate,
  planQmdSeeding,
  syncContextPackWorkspace,
  activateContextPackHelper,
} from './pythonHelpers.js';

export { resolveFocusedRepoRoot, resolveWorkspaceRepoRoots } from './focusedRepo.js';
export type { FocusedRepoResult } from './focusedRepo.js';
export {
  normalizeRelativePath,
  normalizeSupportTargets,
  validateTestTarget,
  isDescendantOrEqual,
  isStrictAncestor,
  hasTraversal,
} from './deepFocusNormalization.js';
export type { NormalizedSupportTarget } from './deepFocusNormalization.js';

export { main as cli } from './cli.js';

export type {
  ActivateOptions,
  SwitchMode,
  SwitchOptions,
  ValidationResult,
  WorkspacePreview,
  PythonHelperOptions,
} from './types.js';
