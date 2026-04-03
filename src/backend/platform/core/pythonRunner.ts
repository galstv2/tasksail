import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PythonRunError } from './types.js';
import type { PythonResult, PythonRunOptions } from './types.js';

/**
 * Detect the Python 3 binary path.
 * Checks in order: PYTHON_BIN env var, .venv/bin/python relative to
 * repoRoot, then falls back to 'python3' on PATH.
 */
export function detectPythonBin(repoRoot?: string): string {
  const envBin = process.env['PYTHON_BIN'];
  if (envBin) {
    return envBin;
  }

  if (repoRoot) {
    const venvBin =
      process.platform === 'win32'
        ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(repoRoot, '.venv', 'bin', 'python');

    if (existsSync(venvBin)) {
      return venvBin;
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3';
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
