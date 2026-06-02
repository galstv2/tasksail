import { describe, it, expect } from 'vitest';
import {
  buildPythonCandidates,
  classifyVersion,
  GateError,
  parsePythonVersion,
  resolvePython,
  runSection,
  SECTION_COMMANDS,
  type CommandResult,
  type CommandRunner,
} from '../osAgnosticismGate.js';

function ok(stdout: string): CommandResult {
  return { status: 0, stdout, stderr: '' };
}

function fail(): CommandResult {
  return { status: 1, stdout: '', stderr: 'boom' };
}

function missing(): CommandResult {
  return { status: null, stdout: '', stderr: '', error: new Error('ENOENT') };
}

describe('buildPythonCandidates', () => {
  it('orders explicit overrides before venv and platform discovery (POSIX)', () => {
    const candidates = buildPythonCandidates(
      {
        TASKSAIL_PYTHON_312_BIN: '/p/py312',
        TASKSAIL_PYTHON_BIN: '/p/pybin',
        PYTHON_BIN: '/p/pythonbin',
      } as NodeJS.ProcessEnv,
      'linux',
      '/repo/.venv/bin/python',
    );
    expect(candidates.map((c) => c.source)).toEqual([
      'TASKSAIL_PYTHON_312_BIN',
      'TASKSAIL_PYTHON_BIN',
      'PYTHON_BIN',
      'repo .venv',
      'python3.12',
      'python3 (compatible fallback)',
    ]);
  });

  it('uses py -3.12 and python fallback on Windows', () => {
    const candidates = buildPythonCandidates({} as NodeJS.ProcessEnv, 'win32', null);
    expect(candidates).toEqual([
      { bin: 'py', baseArgs: ['-3.12'], source: 'py -3.12' },
      { bin: 'python', baseArgs: [], source: 'python (compatible fallback)' },
    ]);
  });

  it('omits the venv candidate when no venv interpreter exists', () => {
    const candidates = buildPythonCandidates({} as NodeJS.ProcessEnv, 'linux', null);
    expect(candidates.map((c) => c.source)).toEqual([
      'python3.12',
      'python3 (compatible fallback)',
    ]);
  });
});

describe('parsePythonVersion', () => {
  it('parses bare and prefixed version strings', () => {
    expect(parsePythonVersion('3.12')).toEqual({ major: 3, minor: 12 });
    expect(parsePythonVersion('Python 3.13.3\n')).toEqual({ major: 3, minor: 13 });
  });

  it('returns null for unparseable output', () => {
    expect(parsePythonVersion('no version here')).toBeNull();
  });
});

describe('classifyVersion', () => {
  it('rejects below 3.12, prefers 3.12, treats above as compatible', () => {
    expect(classifyVersion({ major: 3, minor: 11 })).toBe('reject');
    expect(classifyVersion({ major: 2, minor: 7 })).toBe('reject');
    expect(classifyVersion({ major: 3, minor: 12 })).toBe('preferred');
    expect(classifyVersion({ major: 3, minor: 13 })).toBe('compatible');
    expect(classifyVersion({ major: 4, minor: 0 })).toBe('compatible');
  });
});

describe('resolvePython', () => {
  const cwd = '/repo';

  it('prefers python3.12 over a generic python3 that reports 3.13', () => {
    const runner: CommandRunner = (bin) => (bin === 'python3.12' ? ok('3.12') : ok('3.13'));
    const candidates = buildPythonCandidates({} as NodeJS.ProcessEnv, 'linux', null);
    const resolved = resolvePython(runner, candidates, cwd);
    expect(resolved.candidate.bin).toBe('python3.12');
    expect(resolved.version).toEqual({ major: 3, minor: 12 });
  });

  it('falls back to python3 (3.13) with compatible classification when 3.12 is absent', () => {
    const runner: CommandRunner = (bin) => (bin === 'python3.12' ? missing() : ok('3.13'));
    const candidates = buildPythonCandidates({} as NodeJS.ProcessEnv, 'linux', null);
    const resolved = resolvePython(runner, candidates, cwd);
    expect(resolved.candidate.bin).toBe('python3');
    expect(classifyVersion(resolved.version)).toBe('compatible');
  });

  it('returns an explicit override even when it is too old (caller rejects it)', () => {
    const runner: CommandRunner = () => ok('3.11');
    const candidates = buildPythonCandidates(
      { TASKSAIL_PYTHON_BIN: '/old/python' } as NodeJS.ProcessEnv,
      'linux',
      null,
    );
    const resolved = resolvePython(runner, candidates, cwd);
    expect(resolved.candidate.source).toBe('TASKSAIL_PYTHON_BIN');
    expect(classifyVersion(resolved.version)).toBe('reject');
  });

  it('throws GateError when no interpreter is available', () => {
    const runner: CommandRunner = () => missing();
    const candidates = buildPythonCandidates({} as NodeJS.ProcessEnv, 'linux', null);
    expect(() => resolvePython(runner, candidates, cwd)).toThrow(GateError);
  });
});

describe('SECTION_COMMANDS registry', () => {
  it('exposes a command list for every gate section and final', () => {
    for (const id of ['section-0', 'section-1', 'section-2', 'section-3', 'section-4', 'section-5', 'section-6', 'section-7', 'final']) {
      expect(SECTION_COMMANDS[id]).toBeDefined();
    }
  });

  it('registers both PackWriter pytest suites under section-2', () => {
    const pytestPaths = SECTION_COMMANDS['section-2']
      .filter((c): c is Extract<typeof c, { kind: 'pytest' }> => c.kind === 'pytest')
      .flatMap((c) => c.paths);
    expect(pytestPaths).toContain('tests/domains/pack_writer/test_pack_writer.py');
    expect(pytestPaths).toContain('tests/domains/pack_writer/test_pack_writer_operator_updates.py');
  });

  it('routes the Python version policy check through section-3 and final', () => {
    const labels = (id: string) => SECTION_COMMANDS[id].map((c) => c.label);
    expect(labels('section-3')).toContain('python-version-policy');
    expect(labels('final')).toContain('python-version-policy');
  });
});

describe('runSection', () => {
  const baseEnv = {} as NodeJS.ProcessEnv;

  function makeOpts(overrides: Partial<Parameters<typeof runSection>[1]> = {}) {
    return {
      opts: {
        env: baseEnv,
        platform: 'linux' as NodeJS.Platform,
        venvBin: null,
        cwd: '/repo',
        repoRoot: '/repo',
        runner: ((_bin: string, args: string[]) =>
          args.includes('-c') ? ok('3.12') : ok('')) as CommandRunner,
        checkRunner: async () => ({ ok: true, messages: [] }),
        ...overrides,
      },
    };
  }

  it('passes a section whose pytest commands all exit 0 and reports them', async () => {
    const { opts } = makeOpts();
    const result = await runSection('section-2', opts);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.reports.map((report) => report.label)).toContain('pack-writer');
    expect(result.reports.every((report) => report.ok)).toBe(true);
  });

  it('fails the section and flags the failing command when a pytest exits non-zero', async () => {
    const runner: CommandRunner = (_bin, args) => (args.includes('-c') ? ok('3.12') : fail());
    const { opts } = makeOpts({ runner });
    const result = await runSection('section-2', opts);
    expect(result.ok).toBe(false);
    expect(result.reports.some((report) => !report.ok)).toBe(true);
  });

  it('rejects an interpreter below 3.12 before running any command', async () => {
    const runner: CommandRunner = () => ok('3.11');
    const { opts } = makeOpts({ runner });
    await expect(runSection('section-2', opts)).rejects.toBeInstanceOf(GateError);
  });

  it('warns when running on a compatible fallback above 3.12', async () => {
    const runner: CommandRunner = (_bin, args) => (args.includes('-c') ? ok('3.13') : ok(''));
    const { opts } = makeOpts({ runner });
    const result = await runSection('section-1', opts);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('compatible fallback');
  });

  it('marks a failing structural check as a section failure', async () => {
    const { opts } = makeOpts({
      checkRunner: async () => ({ ok: false, messages: ['stale Python 3.11 claim'] }),
    });
    const result = await runSection('section-3', opts);
    expect(result.ok).toBe(false);
  });

  it('throws on an unknown section id', async () => {
    const { opts } = makeOpts();
    await expect(runSection('section-99', opts)).rejects.toBeInstanceOf(GateError);
  });
});
