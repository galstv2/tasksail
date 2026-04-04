import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readTextFile, extractMarkdownSection, getErrorMessage } from '../../core/index.js';
import { resolveSelectedPrimaryRepoRoot } from '../../context-pack/focusedRepo.js';
import { listSliceFiles } from '../artifactCompletion.js';
import { appendFocusBlock } from './monolithFocusPrompt.js';

export interface TestCaptureResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function resolveTestCaptureCwdFromFocused(
  focused: { primaryRepoRoot: string; primaryFocusRelativePath?: string } | undefined,
): string | undefined {
  if (!focused) {
    return undefined;
  }

  if (!focused.primaryFocusRelativePath) {
    return focused.primaryRepoRoot;
  }

  const focusCwd = path.join(focused.primaryRepoRoot, focused.primaryFocusRelativePath);
  return existsSync(focusCwd) ? focusCwd : undefined;
}

export async function resolveTestCaptureCwd(options: {
  repoRoot: string;
  contextPackDir?: string;
}): Promise<string | undefined> {
  if (!options.contextPackDir) {
    return options.repoRoot;
  }

  const focused = await resolveSelectedPrimaryRepoRoot(
    options.contextPackDir,
    options.repoRoot,
  );
  return resolveTestCaptureCwdFromFocused(focused);
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes per command
const MAX_OUTPUT_LINES = 200;
/** Cap in-flight accumulation to prevent OOM from verbose commands. */
const MAX_CAPTURE_BYTES = 512 * 1024; // 512 KB

/**
 * Extract validation commands from slice content.
 * Looks for a ## Validation Commands section and extracts code-fenced command blocks.
 */
export function extractValidationCommands(sliceContent: string): string[] {
  const sectionContent = extractMarkdownSection(sliceContent, 'Validation Commands');
  if (!sectionContent) return [];
  const commands: string[] = [];

  const codeFenceRegex = /```(?:\w*)\n([\s\S]*?)```/g;
  let match;
  while ((match = codeFenceRegex.exec(sectionContent)) !== null) {
    const fenceContent = match[1].trim();
    for (const line of fenceContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        commands.push(trimmed);
      }
    }
  }

  return commands;
}

/**
 * Run a single command and capture its output.
 */
async function runSingleCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<TestCaptureResult> {
  return new Promise<TestCaptureResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn('sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < MAX_CAPTURE_BYTES) stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_CAPTURE_BYTES) stderr += data.toString();
    });

    let killEscalation: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killEscalation = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killEscalation) clearTimeout(killEscalation);
      resolve({
        command,
        exitCode: code ?? 1,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killEscalation) clearTimeout(killEscalation);
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
 */
export async function runTestCapture(
  commands: string[],
  cwd: string,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<TestCaptureResult[]> {
  const uniqueCommands = [...new Set(commands)];

  // Run sequentially to avoid resource contention
  const results: TestCaptureResult[] = [];
  for (const command of uniqueCommands) {
    try {
      results.push(await runSingleCommand(command, cwd, timeoutMs));
    } catch {
      results.push({
        command,
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
): Promise<TestCaptureResult[]> {
  try {
    const allCommands = await collectSliceValidationCommands(implementationStepsDir);
    if (allCommands.length === 0) return [];
    return await runTestCapture(allCommands, cwd);
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
  primaryFocusRelativePath?: string,
): string {
  const evidence = formatTestCaptureForPrompt(results);
  const parts = [
    'Review the code changes and orchestrator test results below.',
    '',
  ];
  appendFocusBlock(parts, primaryFocusRelativePath, {
    launchContextLine: 'Use this focus path as the primary implementation scope while reviewing the changes below.',
    scopeLine: 'This prompt does not change your launch CWD or broader QA authority.',
  });
  parts.push(evidence);
  return parts.join('\n');
}

/**
 * Format test capture results as markdown.
 */
function formatTestCaptureForPrompt(results: TestCaptureResult[]): string {
  if (results.length === 0) {
    return '## Orchestrator Test Results\n\nNo validation commands were found in the slices.';
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
