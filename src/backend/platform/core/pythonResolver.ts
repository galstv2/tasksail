import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const VERSION_SNIPPET = 'import sys; sys.stdout.write("%d.%d" % sys.version_info[:2])';
const MIN_MAJOR = 3;
const MIN_MINOR = 12;

export interface PythonInterpreterCandidate {
  bin: string;
  baseArgs: string[];
  source: string;
}

export interface PythonVersion {
  major: number;
  minor: number;
}

export type PythonVersionClass = 'reject' | 'preferred' | 'compatible';

/**
 * Build the ordered interpreter candidate list, matching the gate runner's
 * resolution (osAgnosticismGate.buildPythonCandidates): the explicit overrides
 * (TASKSAIL_PYTHON_312_BIN, then TASKSAIL_PYTHON_BIN, then PYTHON_BIN) and the
 * repo .venv are each queued independently before bare discovery; among bare
 * discovery, python3.12 / py -3.12 precede the generic compatible fallback.
 * resolveInterpreter probes them in order and takes the first that runs, so an
 * unavailable override correctly falls through to the .venv and discovery.
 */
export function buildInterpreterCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  repoRoot: string | undefined,
): PythonInterpreterCandidate[] {
  const candidates: PythonInterpreterCandidate[] = [];
  const push = (bin: string | undefined, baseArgs: string[], source: string): void => {
    if (bin) {
      candidates.push({ bin, baseArgs, source });
    }
  };

  push(env['TASKSAIL_PYTHON_312_BIN'], [], 'TASKSAIL_PYTHON_312_BIN');
  push(env['TASKSAIL_PYTHON_BIN'], [], 'TASKSAIL_PYTHON_BIN');
  push(env['PYTHON_BIN'], [], 'PYTHON_BIN');
  if (repoRoot) {
    const venvBin =
      platform === 'win32'
        ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
        : path.join(repoRoot, '.venv', 'bin', 'python');
    if (existsSync(venvBin)) {
      push(venvBin, [], 'repo .venv');
    }
  }

  if (platform === 'win32') {
    push('py', ['-3.12'], 'py -3.12');
    push('python', [], 'python (compatible fallback)');
  } else {
    push('python3.12', [], 'python3.12');
    push('python3', [], 'python3 (compatible fallback)');
  }

  return candidates;
}

export function parsePythonVersion(text: string): PythonVersion | null {
  const match = /(\d+)\.(\d+)/.exec(text.trim());
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export function classifyPythonVersion(version: PythonVersion): PythonVersionClass {
  if (version.major < MIN_MAJOR || (version.major === MIN_MAJOR && version.minor < MIN_MINOR)) {
    return 'reject';
  }
  if (version.major === MIN_MAJOR && version.minor === MIN_MINOR) {
    return 'preferred';
  }
  return 'compatible';
}

export type VersionProbe = (candidate: PythonInterpreterCandidate) => PythonVersion | null;

function defaultProbe(candidate: PythonInterpreterCandidate): PythonVersion | null {
  const result = spawnSync(candidate.bin, [...candidate.baseArgs, '-c', VERSION_SNIPPET], {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return parsePythonVersion(result.stdout ?? '');
}

export interface ResolvedInterpreter {
  candidate: PythonInterpreterCandidate;
  version: PythonVersion;
}

export interface ResolveRuntimePythonOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  repoRoot?: string;
  probe?: VersionProbe;
}

/** Probe candidates in order and return the first interpreter that runs. */
export function resolveInterpreter(
  candidates: PythonInterpreterCandidate[],
  probe: VersionProbe = defaultProbe,
): ResolvedInterpreter {
  for (const candidate of candidates) {
    const version = probe(candidate);
    if (version) {
      return { candidate, version };
    }
  }
  throw new Error(
    'No usable Python interpreter found. Set TASKSAIL_PYTHON_312_BIN, TASKSAIL_PYTHON_BIN, or PYTHON_BIN to a Python 3.12+ interpreter.',
  );
}

export function formatPythonVersion(version: PythonVersion): string {
  return `${version.major}.${version.minor}`;
}

export function resolveRuntimePython(options: ResolveRuntimePythonOptions = {}): ResolvedInterpreter {
  const candidates = buildInterpreterCandidates(
    options.env ?? process.env,
    options.platform ?? process.platform,
    options.repoRoot,
  );
  return resolveInterpreter(candidates, options.probe);
}
