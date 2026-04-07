/** Result of running a Python script via pythonRunner. */
export interface PythonResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Options for pythonRunner invocations. */
export interface PythonRunOptions {
  /** Working directory for the Python process. */
  cwd?: string;
  /** Environment variables to pass to the process. */
  env?: Record<string, string>;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Data to pipe to stdin. */
  stdin?: string;
  /** Optional cancellation signal for long-running child processes. */
  abortSignal?: AbortSignal;
}

/** Parsed .env key-value map. */
export type EnvMap = Map<string, string>;

/** Resolved platform paths. */
export interface PlatformPaths {
  repoRoot: string;
  agentWorkSpace: string;
  dropbox: string;
  pendingItems: string;
  errorItems: string;
  handoffs: string;
  templates: string;
  implementationSteps: string;
  qmd: string;
  platformState: string;
  guardrails: string;
}

/** Agent autonomy profile names. */
export type AutonomyProfile = 'repo-executor' | 'artifact-author' | 'qa-executor';

/** Workflow agent identifiers matching registry.json. */
export type AgentId =
  | 'lily'
  | 'alice'
  | 'dalton'
  | 'dalton-verify'
  | 'ron';

/** All supported agent identifiers, including operator-only roles. */
export const ALL_AGENT_IDS: AgentId[] = [
  'lily',
  'alice',
  'dalton',
  'dalton-verify',
  'ron',
];

/** Standard unattended pipeline order. Lily is operator-only and excluded. */
export const STANDARD_AGENT_ORDER: AgentId[] = [
  'alice',
  'dalton',
  'ron',
];

/** Retained alias for older call sites; the runtime is standard-only. */
export const FAST_PATH_AGENT_ORDER: AgentId[] = [
  'alice',
  'dalton',
  'ron',
];

/** Container runtime backend selection. */
export type ContainerBackend = 'docker' | 'podman';

/** Typed error for Python script failures, replacing Object.assign on Error. */
export class PythonRunError extends Error {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  constructor(message: string, result: PythonResult) {
    super(message);
    this.name = 'PythonRunError';
    this.stdout = result.stdout;
    this.stderr = result.stderr;
    this.exitCode = result.exitCode;
  }
}
