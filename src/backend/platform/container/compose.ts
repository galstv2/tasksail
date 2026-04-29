import { spawn } from 'node:child_process';
import type { ContainerBackend } from '../core/index.js';
import * as core from '../core/index.js';
import type { ComposeOptions } from './types.js';

/**
 * Build a compose command array for the given backend and action.
 * Returns [command, ...args] suitable for spawn().
 */
export function buildComposeCommand(
  backend: ContainerBackend,
  action: 'up' | 'down' | 'config',
  options: ComposeOptions,
): string[] {
  const cmd = buildComposeBaseCommand(backend, options);

  if (options.projectName) {
    cmd.push('-p', options.projectName);
  }

  const composeFiles = options.composeFiles ?? (options.composeFile ? [options.composeFile] : []);
  for (const composeFile of composeFiles) {
    cmd.push(
      '-f',
      core.toEngineHostPath(composeFile, {
        engineHost: options.engineHost,
        wslDistro: options.wslDistro,
      }),
    );
  }

  cmd.push(action);

  if (action === 'up') {
    if (options.detach !== false) {
      cmd.push('-d');
    }
    if (options.build) {
      cmd.push('--build');
    }
  }

  if (options.services && options.services.length > 0) {
    cmd.push(...options.services);
  }

  return cmd;
}

export function buildComposeBaseCommand(
  backend: ContainerBackend,
  options: ComposeOptions,
): string[] {
  if (options.engineHost === 'wsl') {
    if (!options.wslDistro) {
      throw new Error('container_engine_host=wsl requires container_engine_wsl_distro');
    }
    return ['wsl.exe', '-d', options.wslDistro, '--', backend, 'compose'];
  }

  return [backend, 'compose'];
}

/**
 * Detect which compose command variant is available for the given backend.
 * Tries `<backend> compose version` first, then `<backend>-compose version`.
 * Returns the base command fragments: ['docker', 'compose'] or ['docker-compose'].
 */
export async function detectComposeCommand(
  backend: ContainerBackend,
): Promise<string[]> {
  const variants: string[][] = [
    [backend, 'compose'],
    [`${backend}-compose`],
  ];

  for (const variant of variants) {
    const available = await tryCommand([...variant, 'version']);
    if (available) {
      return variant;
    }
  }

  throw new Error(
    `No compose command found for ${backend}. Ensure ${backend} compose or ${backend}-compose is installed.`,
  );
}

/**
 * Validate a compose configuration file by running `compose config`.
 */
export async function validateComposeConfig(
  backend: ContainerBackend,
  options: ComposeOptions,
): Promise<void> {
  const cmd = buildComposeCommand(backend, 'config', options);
  await execCommand(cmd[0], cmd.slice(1), undefined, options.env);
}

/**
 * Execute a compose command and return when it completes.
 * Rejects if the process exits with a non-zero code.
 */
export function execCommand(
  command: string,
  args: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.stdin.end();

    child.on('error', (err: Error) => {
      reject(new Error(`Failed to run ${command}: ${err.message}`, { cause: err }));
    });

    child.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${code ?? 1}: ${stderr.trim()}`,
          ),
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Try running a command and return whether it succeeded.
 */
function tryCommand(cmd: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end();
    // Intentional: tryCommand probes availability — failure is expected
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
