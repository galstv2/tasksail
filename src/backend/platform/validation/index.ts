export { REQUIRED_DIRS, REQUIRED_FILES, validateStructure } from './structure.js';
export type { StructureResult } from './structure.js';

export { REQUIRED_TOOLS, validateLocalSetup } from './localSetup.js';
export type { ToolCheck, LocalSetupResult } from './localSetup.js';

export {
  FILE_SIZE_LIMITS,
  REFACTOR_THRESHOLD,
  loadBaseline,
  checkFileSizes,
} from './fileSizes.js';
export type { Violation, Warning, FileSizeResult } from './fileSizes.js';

export { runLocalChecks } from './localChecks.js';
export type {
  LocalChecksProfile,
  LocalChecksOptions,
  CheckResult,
  LocalChecksResult,
} from './localChecks.js';

export { getGitStagedFiles, preCommitHook } from './preCommitHook.js';
export type { PreCommitResult } from './preCommitHook.js';

export { checkExternalMcpRegistry } from './externalMcpCheck.js';
export type { ExternalMcpCheckResult } from './externalMcpCheck.js';
