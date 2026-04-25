export {
  findRepoRoot,
  resolvePaths,
  resolvePath,
  ensurePathWithinDropbox,
  isPathWithinBoundary,
} from './paths.js';

export type { ResolvePathsOptions } from './paths.js';

export {
  isWindowsPlatform,
  isMacOSPlatform,
  isLinuxPlatform,
  isWSL,
  isWSLWindowsPath,
  isDockerDesktopBackend,
  toEngineHostPath,
  toContainerPath,
  type EngineHostPathOptions,
} from './platform.js';

export {
  parseEnv,
  loadEnv,
  readEnvAssignment,
  ensureEnvFile,
  upsertEnvVar,
} from './env.js';

export {
  trimWhitespace,
  stripWrappingQuotes,
  slugify,
  jsonEscapeString,
  extractFrontmatter,
  extractMarkdownSection,
  escapeRegExp,
  nowIsoCompact,
  getErrorMessage,
} from './text.js';

export {
  ensureDir,
  readTextFile,
  writeTextFile,
  writeTextFileAtomic,
  moveFile,
  copyFileSafe,
  createTempDir,
  tempFilePath,
  sleep,
  safeJsonParse,
} from './io.js';

export { detectPythonBin, runPython } from './pythonRunner.js';

export { isRecord } from './guards.js';

export type {
  PythonResult,
  PythonRunOptions,
  EnvMap,
  PlatformPaths,
  AutonomyProfile,
  AgentId,
  ContainerBackend,
  ContainerEngineHost,
} from './types.js';

export { ALL_AGENT_IDS, STANDARD_AGENT_ORDER, PythonRunError } from './types.js';
