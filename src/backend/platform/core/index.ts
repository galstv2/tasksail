export {
  findRepoRoot,
  resolvePaths,
  resolvePath,
  ensurePathWithinDropbox,
  isPathWithinBoundary,
  canonicalRoot,
  logsDir,
  logFile,
  taskAgentLogFile,
  logFileWithSuffix,
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

export { loadLogConfig, type LogConfig } from './logConfig.js';

export {
  writeProtocolJson,
  writeProtocolStderr,
  writeProtocolStdout,
} from './protocolOutput.js';

export {
  PlatformError,
  ConfigError,
  ValidationError,
  ContainerError,
  MCPError,
  AgentRunError,
  QueueError,
  ContextPackError,
  InvariantError,
  serializeError,
  exitCodeFor,
  type ErrorCategory,
  type ErrorEnvelope,
  type PlatformErrorOptions,
} from './errors.js';

export {
  createLogger,
  installProcessHandlers,
  newSpanId,
  flushLoggers,
  type Logger,
  type LogContext,
  type ProgressArgs,
  type ProgressEvent,
  type ProgressLevel,
} from './logger.js';

export { runCliBoundary } from './cliBoundary.js';

export {
  trimWhitespace,
  stripWrappingQuotes,
  slugify,
  jsonEscapeString,
  extractFrontmatter,
  stripHtmlComments,
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

export {
  RuntimeTerminalEvents,
  type RuntimeTerminalEventRole,
  type RuntimeTerminalEventSeverity,
} from './runtimeTerminalEvents.js';

export {
  emitTaskProgressEvent,
  formatTaskAgentDisplayName,
  normalizeTaskAgentLaunchOutcome,
  type ChildChainFailureBranchProgressInput,
  type TaskProgressEvent,
  type TaskProgressEventType,
} from './taskProgressEvents.js';

export {
  normalizeAgentLaunchPhase,
  formatTaskAgentLaunchMessage,
  type TaskAgentLaunchOutcome,
  type TaskAgentLaunchPhase,
} from './taskTerminalEventContracts.js';

export { detectPythonBin, runPython } from './pythonRunner.js';

export { isRecord, isMissingPathError } from './guards.js';

export type {
  PythonResult,
  PythonRunOptions,
  EnvMap,
  PlatformPaths,
  AutonomyProfile,
  AgentId,
  AgentRunStatus,
  ContainerBackend,
  ContainerEngineHost,
} from './types.js';

export { ALL_AGENT_IDS, STANDARD_AGENT_ORDER, PythonRunError } from './types.js';
