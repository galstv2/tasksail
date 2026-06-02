import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isWindowsPlatform } from './platform.js';
import { PythonRunError } from './types.js';
import type { PythonResult, PythonRunOptions } from './types.js';

/**
 * Detect the Python binary path (single source of truth for the binary to spawn).
 * Checks in order: TASKSAIL_PYTHON_312_BIN, TASKSAIL_PYTHON_BIN, PYTHON_BIN env
 * vars, the repo `.venv` interpreter, then 'python3' on POSIX / 'python' on
 * Windows. TASKSAIL_PYTHON_312_BIN wins so an explicitly configured Python 3.12
 * is preferred before compatible fallbacks. Version policy (prefer 3.12, reject
 * below 3.12) is enforced by pythonCli/preflight, not here.
 */
export function detectPythonBin(repoRoot?: string): string {
  const envBin =
    process.env['TASKSAIL_PYTHON_312_BIN']
    ?? process.env['TASKSAIL_PYTHON_BIN']
    ?? process.env['PYTHON_BIN'];
  if (envBin) {
    return envBin;
  }

  if (repoRoot) {
    const venvBin =
      isWindowsPlatform()
        ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(repoRoot, '.venv', 'bin', 'python');

    if (existsSync(venvBin)) {
      return venvBin;
    }
  }

  return isWindowsPlatform() ? 'python' : 'python3';
}

/**
 * Run a Python script and capture its output.
 * Rejects with an error if the script exits with a non-zero code.
 */
export function runPython(
  scriptPath: string,
  args: string[] = [],
  options: PythonRunOptions = {},
): Promise<PythonResult> {
  return new Promise((resolve, reject) => {
    if (options.abortSignal?.aborted) {
      reject(new Error('Python script aborted before start.'));
      return;
    }

    const pythonBin = detectPythonBin(options.cwd);

    if (
      scriptPath.includes('..') ||
      (!path.isAbsolute(scriptPath) && scriptPath.includes('/'))
    ) {
      const resolved = path.resolve(options.cwd ?? process.cwd(), scriptPath);
      scriptPath = resolved;
    }

    const env = {
      ...process.env,
      ...options.env,
    };

    const child = spawn(pythonBin, [scriptPath, ...args], {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout,
    });

    let stdout = '';
    let stderr = '';
    let aborted = false;
    let abortGraceTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanupAbort = (): void => {
      if (abortGraceTimer) {
        clearTimeout(abortGraceTimer);
      }
      options.abortSignal?.removeEventListener('abort', onAbort);
    };

    const onAbort = (): void => {
      if (aborted) {
        return;
      }
      aborted = true;
      child.kill('SIGTERM');
      abortGraceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 5000);
    };

    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('error', (err: Error) => {
      cleanupAbort();
      reject(
        new Error(`Failed to start Python: ${err.message}`, { cause: err }),
      );
    });

    child.on('close', (code: number | null) => {
      cleanupAbort();
      if (aborted) {
        reject(new Error('Python script aborted.'));
        return;
      }
      const exitCode = code ?? 1;
      const result: PythonResult = { stdout, stderr, exitCode };

      if (exitCode !== 0) {
        reject(new PythonRunError(
          `Python script exited with code ${exitCode}: ${stderr.trim()}`,
          result,
        ));
      } else {
        resolve(result);
      }
    });
  });
}
