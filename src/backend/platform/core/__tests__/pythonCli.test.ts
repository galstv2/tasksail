import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect } from 'vitest';
import {
  buildInterpreterCandidates,
  classifyPythonVersion,
  parsePythonVersion,
  resolveInterpreter,
  type PythonInterpreterCandidate,
} from '../pythonResolver.js';

describe('buildInterpreterCandidates', () => {
  it('queues each explicit override independently in 312 → BIN → PYTHON_BIN order before discovery (POSIX)', () => {
    const candidates = buildInterpreterCandidates(
      {
        TASKSAIL_PYTHON_312_BIN: '/p/py312',
        TASKSAIL_PYTHON_BIN: '/p/pybin',
        PYTHON_BIN: '/p/pythonbin',
      } as NodeJS.ProcessEnv,
      'linux',
      '/repo',
    );
    expect(candidates[0]).toEqual({
      bin: '/p/py312',
      baseArgs: [],
      source: 'TASKSAIL_PYTHON_312_BIN',
    });
    // All three overrides are queued separately (not collapsed via ??), so an
    // unavailable higher-priority override falls through to the next one and then
    // to bare discovery — matching osAgnosticismGate.buildPythonCandidates.
    expect(candidates.map((c) => c.source)).toEqual([
      'TASKSAIL_PYTHON_312_BIN',
      'TASKSAIL_PYTHON_BIN',
      'PYTHON_BIN',
      'python3.12',
      'python3 (compatible fallback)',
    ]);
  });

  it('queues the repo .venv even when an explicit override is set (POSIX)', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'pycli-venv-'));
    try {
      const venvBin = path.join(repoRoot, '.venv', 'bin', 'python');
      mkdirSync(path.dirname(venvBin), { recursive: true });
      writeFileSync(venvBin, '');
      const candidates = buildInterpreterCandidates(
        { TASKSAIL_PYTHON_BIN: '/p/pybin' } as NodeJS.ProcessEnv,
        'linux',
        repoRoot,
      );
      // The override does NOT suppress the dep-complete .venv; both precede discovery.
      expect(candidates.map((c) => c.source)).toEqual([
        'TASKSAIL_PYTHON_BIN',
        'repo .venv',
        'python3.12',
        'python3 (compatible fallback)',
      ]);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('falls through to TASKSAIL_PYTHON_BIN then PYTHON_BIN when 312 is unset', () => {
    expect(
      buildInterpreterCandidates(
        { TASKSAIL_PYTHON_BIN: '/b', PYTHON_BIN: '/c' } as NodeJS.ProcessEnv,
        'linux',
        undefined,
      )[0].bin,
    ).toBe('/b');
    expect(
      buildInterpreterCandidates({ PYTHON_BIN: '/c' } as NodeJS.ProcessEnv, 'linux', undefined)[0].bin,
    ).toBe('/c');
  });

  it('discovers py -3.12 then python on Windows', () => {
    expect(buildInterpreterCandidates({} as NodeJS.ProcessEnv, 'win32', undefined)).toEqual([
      { bin: 'py', baseArgs: ['-3.12'], source: 'py -3.12' },
      { bin: 'python', baseArgs: [], source: 'python (compatible fallback)' },
    ]);
  });
});

describe('parsePythonVersion / classifyPythonVersion', () => {
  it('parses bare and prefixed versions, rejects garbage', () => {
    expect(parsePythonVersion('3.12.1')).toEqual({ major: 3, minor: 12 });
    expect(parsePythonVersion('Python 3.13.3')).toEqual({ major: 3, minor: 13 });
    expect(parsePythonVersion('no version')).toBeNull();
  });

  it('rejects below 3.12, prefers 3.12, treats above as compatible', () => {
    expect(classifyPythonVersion({ major: 3, minor: 11 })).toBe('reject');
    expect(classifyPythonVersion({ major: 3, minor: 12 })).toBe('preferred');
    expect(classifyPythonVersion({ major: 3, minor: 13 })).toBe('compatible');
  });
});

describe('resolveInterpreter', () => {
  const candidates = buildInterpreterCandidates({} as NodeJS.ProcessEnv, 'linux', undefined);

  it('prefers python3.12 over a python3 that reports 3.13', () => {
    const probe = (c: PythonInterpreterCandidate) =>
      c.bin === 'python3.12' ? { major: 3, minor: 12 } : { major: 3, minor: 13 };
    expect(resolveInterpreter(candidates, probe).candidate.bin).toBe('python3.12');
  });

  it('accepts the python3 fallback (3.13) with a compatible classification when 3.12 is absent', () => {
    const probe = (c: PythonInterpreterCandidate) =>
      c.bin === 'python3.12' ? null : { major: 3, minor: 13 };
    const resolved = resolveInterpreter(candidates, probe);
    expect(resolved.candidate.bin).toBe('python3');
    expect(classifyPythonVersion(resolved.version)).toBe('compatible');
  });

  it('throws when no interpreter is available', () => {
    expect(() => resolveInterpreter(candidates, () => null)).toThrow(/No usable Python/);
  });
});
