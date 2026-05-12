import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readTextFile, getErrorMessage } from '../../core/index.js';
import { isWindowsPlatform } from '../../core/platform.js';
import { getEffectiveScopeForPrimary, resolveSelectedPrimaryRepoRoot } from '../../context-pack/focusedRepo.js';
import { listSliceFiles } from '../artifactCompletion.js';
import {
  applyWorktreeInjectionToFocused,
  buildWorktreeBindingMap,
} from '../worktreeInjection.js';
import {
  appendFocusBlock,
  type FocusScopePromptOptions,
} from './focusScopePrompt.js';
import type { FocusTarget, PrimaryFocusTarget } from '../../context-pack/deepFocusNormalization.js';
import { appendMcpContextBlock } from './mcpPromptContext.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';
import { parseSections, resolveSemanticSection } from '../../workflow-policy/artifacts.js';
import { SLICE_REQUIRED_SECTION_SPECS } from '../../workflow-policy/models.js';
import { loadMarkdownContract } from '../../workflow-policy/contracts/markdownContract.js';

export interface TestCaptureResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function resolveTestCaptureCwdFromFocused(
  focused: {
    primaryRepoRoot: string;
    primaryFocusTargets?: PrimaryFocusTarget[];
    primaryFocusRelativePath?: string;
    primaryFocusTargetKind?: 'directory' | 'file';
    testTarget?: FocusTarget;
  } | undefined,
): string | undefined {
  if (!focused) {
    return undefined;
  }

  const testTarget = resolveAnchorTestTarget(focused);
  if (!testTarget) {
    return existsSync(focused.primaryRepoRoot) ? focused.primaryRepoRoot : undefined;
  }

  const focusCwd = testTarget.kind === 'file'
    ? path.join(focused.primaryRepoRoot, path.dirname(testTarget.path))
    : path.join(focused.primaryRepoRoot, testTarget.path);
  return existsSync(focusCwd) ? focusCwd : undefined;
}

function resolveAnchorTestTarget(focused: {
  primaryFocusTargets?: PrimaryFocusTarget[];
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: 'directory' | 'file';
  testTarget?: FocusTarget;
}): FocusTarget | undefined {
  const anchor = resolveAnchorPrimaryTarget(focused);
  if (!anchor) {
    return focused.testTarget;
  }
  return getEffectiveScopeForPrimary(anchor, { testTarget: focused.testTarget }).testTarget;
}

function resolveAnchorPrimaryTarget(focused: {
  primaryFocusTargets?: PrimaryFocusTarget[];
  primaryFocusRelativePath?: string;
  primaryFocusTargetKind?: 'directory' | 'file';
}): PrimaryFocusTarget | undefined {
  const targets = focused.primaryFocusTargets ?? [];
  const anchor = targets.find((target) => target.role === 'anchor') ?? targets[0];
  if (anchor) {
    return anchor;
  }
  if (focused.primaryFocusRelativePath === undefined && focused.primaryFocusTargetKind === undefined) {
    return undefined;
  }
  return {
    path: focused.primaryFocusRelativePath ?? '',
    kind: focused.primaryFocusTargetKind ?? 'directory',
    role: 'anchor',
  };
}

export async function resolveTestCaptureCwd(options: {
  repoRoot: string;
  taskId: string;
  contextPackDir?: string;
}): Promise<string | undefined> {
  if (!options.contextPackDir) {
    return options.repoRoot;
  }

  const focused = await resolveSelectedPrimaryRepoRoot(
    options.contextPackDir,
    options.repoRoot,
    { taskId: options.taskId },
  );
  if (!focused) {
    return undefined;
  }

  const bindingMap = await buildWorktreeBindingMap(options.taskId, options.repoRoot);
  const injected = applyWorktreeInjectionToFocused(focused, bindingMap);
  return resolveTestCaptureCwdFromFocused(injected);
}

const DEFAULT_COMMAND_TIMEOUT_MS = 90_000; // 90 seconds per command
const MAX_TOTAL_CAPTURE_MS = 300_000; // 5 minutes total budget
const MAX_OUTPUT_LINES = 200;
/** Cap in-flight accumulation to prevent OOM from verbose commands. */
const MAX_CAPTURE_BYTES = 512 * 1024; // 512 KB

type TestCaptureShellInvocation = {
  file: string;
  args: string[];
  detached: boolean;
};

export function resolveTestCaptureShell(command: string): TestCaptureShellInvocation {
  if (isWindowsPlatform()) {
    return {
      file: process.env['ComSpec'] ?? process.env['COMSPEC'] ?? 'cmd.exe',
      args: ['/c', command],
      detached: false,
    };
  }

  return {
    file: 'sh',
    args: ['-c', command],
    detached: true,
  };
}

/**
 * Extract validation commands from slice content.
 * Resolves the semantic validation-commands section and extracts code-fenced command blocks.
 */
export function extractValidationCommands(sliceContent: string): string[] {
  const validationCommandsSpec = SLICE_REQUIRED_SECTION_SPECS.find(
    (sectionSpec) => sectionSpec.key === 'validation-commands',
  );
  if (!validationCommandsSpec) {
    return [];
  }
  const sections = parseSections(sliceContent);
  const sectionContent = resolveSemanticSection(sections, validationCommandsSpec).content.join('\n').trim();
  if (!sectionContent) {
    return [];
  }
  return extractCommandsFromFences(sectionContent);
}

function extractCommandsFromFences(sectionContent: string): string[] {
  const contract = loadMarkdownContract();
  const commands: string[] = [];
  let activeFence: string | null = null;
  let pendingContinuation: string | null = null;

  const flushPending = (): void => {
    if (pendingContinuation?.trim()) {
      commands.push(pendingContinuation.trim());
    }
    pendingContinuation = null;
  };

  for (const rawLine of sectionContent.split(/\r?\n/)) {
    if (!activeFence) {
      const openMatch = contract.compiled.fenceOpen.exec(rawLine);
      if (openMatch?.[contract.groups.fenceMarker]) {
        activeFence = openMatch[contract.groups.fenceMarker]!;
      }
      continue;
    }

    if (rawLine.trim() === activeFence) {
      flushPending();
      activeFence = null;
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      continue;
    }

    const withoutContinuation = removeSingleContinuationBackslash(trimmed);
    const hasContinuation = withoutContinuation !== null;
    const fragment = hasContinuation ? withoutContinuation : trimmed;
    if (pendingContinuation !== null) {
      pendingContinuation = `${pendingContinuation} ${fragment}`.trim();
    } else {
      pendingContinuation = fragment;
    }

    if (!hasContinuation) {
      flushPending();
    }
  }

  return commands;
}

function removeSingleContinuationBackslash(value: string): string | null {
  let slashCount = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount === 1 ? value.slice(0, -1).trimEnd() : null;
}

/**
 * Kill the entire process group on Unix (sh + children). On Windows, fall back
 * to terminating the spawned shell directly because negative-PID group signals
 * are not supported.
 */
function killProcessGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) {
    return;
  }

  if (isWindowsPlatform()) {
    try { child.kill(signal); } catch { /* already dead */ }
    return;
  }

  try {
    process.kill(-child.pid!, signal);
  } catch {
    try { child.kill(signal); } catch { /* already dead */ }
  }
}

/**
 * Run a single command and capture its output.
 */
async function runSingleCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TestCaptureResult> {
  return new Promise<TestCaptureResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const shellInvocation = resolveTestCaptureShell(command);
    const child = spawn(shellInvocation.file, shellInvocation.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: shellInvocation.detached,
    });
    if (shellInvocation.detached) {
      child.unref();
    }

    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += data.toString();
    });

    let killEscalation: ReturnType<typeof setTimeout> | undefined;

    const killWithEscalation = (): void => {
      killProcessGroup(child, 'SIGTERM');
      if (!isWindowsPlatform()) {
        killEscalation = setTimeout(() => killProcessGroup(child, 'SIGKILL'), 5_000);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killWithEscalation();
    }, timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      killWithEscalation();
    };
    if (signal && !signal.aborted) {
      signal.addEventListener('abort', onAbort, { once: true });
    } else if (signal?.aborted) {
      aborted = true;
      killWithEscalation();
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killEscalation) clearTimeout(killEscalation);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    child.on('close', (code) => {
      cleanup();
      resolve({
        command,
        exitCode: code ?? 1,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut: timedOut || aborted,
      });
    });

    child.on('error', (err) => {
      cleanup();
      resolve({
        command,
        exitCode: 1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
      });
    });
  });
}

function truncateOutput(output: string): string {
  const lines = output.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES) return output;
  return `[... truncated ${lines.length - MAX_OUTPUT_LINES} lines ...]\n` +
    lines.slice(-MAX_OUTPUT_LINES).join('\n');
}

/**
 * Run multiple validation commands and capture all results.
 * Enforces a total time budget across all commands.
 */
export async function runTestCapture(
  commands: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<TestCaptureResult[]> {
  const uniqueCommands = [...new Set(commands)];
  const budgetStart = Date.now();

  // Run sequentially to avoid resource contention
  const results: TestCaptureResult[] = [];
  for (let i = 0; i < uniqueCommands.length; i++) {
    if (signal?.aborted) break;

    const elapsed = Date.now() - budgetStart;
    const remaining = MAX_TOTAL_CAPTURE_MS - elapsed;
    if (remaining <= 0) {
      const skipped = uniqueCommands.length - i;
      results.push({
        command: `(${skipped} remaining command${skipped > 1 ? 's' : ''} skipped)`,
        exitCode: 0,
        stdout: '',
        stderr: `Remaining ${skipped} command${skipped > 1 ? 's' : ''} skipped — capture time budget exhausted (${MAX_TOTAL_CAPTURE_MS / 1000}s).`,
        timedOut: true,
      });
      break;
    }

    const effectiveTimeout = Math.min(timeoutMs, remaining);
    try {
      results.push(await runSingleCommand(uniqueCommands[i], cwd, effectiveTimeout, signal));
    } catch {
      results.push({
        command: uniqueCommands[i],
        exitCode: 1,
        stdout: '',
        stderr: 'Internal capture error — command could not be executed.',
        timedOut: false,
      });
    }
  }
  return results;
}

/**
 * Collect all validation commands from slice files. Shared by both the
 * verification prompt builder and the test capture runner.
 */
export async function collectSliceValidationCommands(
  implementationStepsDir: string,
): Promise<string[]> {
  const sliceFiles = await listSliceFiles(implementationStepsDir);
  const sliceContents = await Promise.all(sliceFiles.map((f) => readTextFile(f)));
  return sliceContents
    .filter((c): c is string => c != null)
    .flatMap((c) => extractValidationCommands(c));
}

/**
 * Read slice files from the implementation steps directory, extract validation
 * commands, and run them. Returns empty array when no commands are found or
 * when any step fails — test capture must never kill the pipeline.
 */
export async function captureSliceValidation(
  implementationStepsDir: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<TestCaptureResult[]> {
  try {
    const allCommands = await collectSliceValidationCommands(implementationStepsDir);
    if (allCommands.length === 0) return [];
    return await runTestCapture(allCommands, cwd, DEFAULT_COMMAND_TIMEOUT_MS, signal);
  } catch (err) {
    console.warn(
      '[testCapture] captureSliceValidation failed, continuing without test evidence:',
      getErrorMessage(err),
    );
    return [];
  }
}

/**
 * Build the prompt override string for Ron with test evidence.
 */
export function buildTestCapturePrompt(
  results: TestCaptureResult[],
  focusScope?: FocusScopePromptOptions,
  externalMcpRegistry?: ExternalMcpRegistry,
  warning?: string,
): string {
  const evidence = formatTestCaptureForPrompt(results, warning);
  const parts = [
    'Review the code changes and orchestrator test results below.',
    '',
  ];
  appendFocusBlock(parts, {
    ...focusScope,
    launchContextLine: 'Use the primary focus as the review starting point while reviewing the changes below.',
    scopeLine: 'Writable roots describe Dalton implementation authority; this prompt does not change your launch CWD or broader QA authority.',
  });
  appendMcpContextBlock(parts, externalMcpRegistry, 'ron');
  parts.push(evidence);
  return parts.join('\n');
}

/**
 * Format test capture results as markdown.
 */
function formatTestCaptureForPrompt(results: TestCaptureResult[], warning?: string): string {
  if (results.length === 0) {
    const message = warning ?? 'No validation commands were found in the slices.';
    return `## Orchestrator Test Results\n\n${message}`;
  }

  const parts: string[] = ['## Orchestrator Test Results\n'];

  for (const result of results) {
    const status = result.timedOut ? 'TIMEOUT' : result.exitCode === 0 ? 'PASS' : 'FAIL';
    parts.push(`### Command: \`${result.command}\``);
    parts.push(`**Status:** ${status} (exit code: ${result.exitCode})`);

    if (result.stdout.trim()) {
      parts.push('**stdout:**');
      parts.push('```');
      parts.push(result.stdout.trim());
      parts.push('```');
    }

    if (result.stderr.trim()) {
      parts.push('**stderr:**');
      parts.push('```');
      parts.push(result.stderr.trim());
      parts.push('```');
    }

    parts.push('');
  }

  const passCount = results.filter(r => r.exitCode === 0 && !r.timedOut).length;
  parts.push(`**Summary:** ${passCount}/${results.length} commands passed.`);

  return parts.join('\n');
}
