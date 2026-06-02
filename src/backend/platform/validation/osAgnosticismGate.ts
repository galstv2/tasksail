#!/usr/bin/env node

/**
 * Cross-platform OS-agnosticism section gate runner.
 *
 * Executes the Python-interpreter-sensitive and structural portions of each
 * section gate using argv arrays (never POSIX shell strings) so the same gate
 * runs identically on Windows, macOS, and Linux. Python is resolved through a
 * fixed priority that strongly prefers Python 3.12, accepts a compatible
 * fallback above 3.12 with a warning, and rejects anything below 3.12.
 *
 * Invoked as: tsx osAgnosticismGate.ts <section-0..section-7|final>
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot, runCliBoundary, writeProtocolStderr, writeProtocolStdout } from '../core/index.js';

// Emits "major.minor" with no trailing newline so parsing stays simple.
const VERSION_SNIPPET = 'import sys; sys.stdout.write("%d.%d" % sys.version_info[:2])';

export class GateError extends Error {}

export interface PythonVersion {
  major: number;
  minor: number;
}

export interface PythonCandidate {
  bin: string;
  baseArgs: string[];
  source: string;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/** Runs an external command with argv arrays and no shell interpolation. */
export type CommandRunner = (bin: string, args: string[], cwd: string) => CommandResult;

/** Runs a structural check module that exports runCheck(repoRoot). */
export type CheckRunner = (
  moduleRef: string,
  repoRoot: string,
) => Promise<{ ok: boolean; messages: string[] }>;

export type VersionClass = 'reject' | 'preferred' | 'compatible';

export type GateCommand =
  | { kind: 'pytest'; label: string; paths: string[] }
  | { kind: 'check'; label: string; module: string };

/**
 * Per-section cross-platform commands. Focused Vitest commands are run directly
 * by each section gate via `pnpm exec vitest`; this registry owns the Python
 * pytest suites and structural TS checks that must use the resolved interpreter
 * or run in-process for cross-OS consistency.
 */
export const SECTION_COMMANDS: Record<string, GateCommand[]> = {
  'section-0': [],
  'section-1': [
    { kind: 'pytest', label: 'qmd-stub-scope', paths: ['tests/domains/qmd/test_stub_scope.py'] },
  ],
  'section-2': [
    { kind: 'pytest', label: 'pack-writer', paths: ['tests/domains/pack_writer/test_pack_writer.py'] },
    {
      kind: 'pytest',
      label: 'pack-writer-operator-updates',
      paths: ['tests/domains/pack_writer/test_pack_writer_operator_updates.py'],
    },
  ],
  'section-3': [
    { kind: 'check', label: 'python-version-policy', module: './pythonVersionPolicyCheck.js' },
    { kind: 'pytest', label: 'pack-preflight', paths: ['tests/domains/pack_preflight/test_preflight.py'] },
  ],
  'section-4': [],
  'section-5': [],
  'section-6': [],
  'section-7': [
    { kind: 'check', label: 'workflow-matrix', module: './workflowMatrixCheck.js' },
  ],
  final: [
    { kind: 'check', label: 'python-version-policy', module: './pythonVersionPolicyCheck.js' },
    { kind: 'check', label: 'workflow-matrix', module: './workflowMatrixCheck.js' },
    { kind: 'pytest', label: 'pack-writer', paths: ['tests/domains/pack_writer/test_pack_writer.py'] },
    {
      kind: 'pytest',
      label: 'pack-writer-operator-updates',
      paths: ['tests/domains/pack_writer/test_pack_writer_operator_updates.py'],
    },
    { kind: 'pytest', label: 'qmd-stub-scope', paths: ['tests/domains/qmd/test_stub_scope.py'] },
    { kind: 'pytest', label: 'pack-preflight', paths: ['tests/domains/pack_preflight/test_preflight.py'] },
  ],
};

/**
 * Build the ordered Python interpreter candidate list. Explicit operator
 * overrides win first, then the repo virtualenv, then the platform-specific
 * 3.12 discovery name, then the generic compatible fallback.
 */
export function buildPythonCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  venvBin: string | null,
): PythonCandidate[] {
  const candidates: PythonCandidate[] = [];
  const push = (bin: string | undefined, baseArgs: string[], source: string): void => {
    if (bin) {
      candidates.push({ bin, baseArgs, source });
    }
  };

  push(env['TASKSAIL_PYTHON_312_BIN'], [], 'TASKSAIL_PYTHON_312_BIN');
  push(env['TASKSAIL_PYTHON_BIN'], [], 'TASKSAIL_PYTHON_BIN');
  push(env['PYTHON_BIN'], [], 'PYTHON_BIN');
  if (venvBin) {
    push(venvBin, [], 'repo .venv');
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

export function classifyVersion(version: PythonVersion): VersionClass {
  if (version.major < 3 || (version.major === 3 && version.minor < 12)) {
    return 'reject';
  }
  if (version.major === 3 && version.minor === 12) {
    return 'preferred';
  }
  return 'compatible';
}

export function formatVersion(version: PythonVersion): string {
  return `${version.major}.${version.minor}`;
}

export interface ResolvedPython {
  candidate: PythonCandidate;
  version: PythonVersion;
}

/**
 * Probe candidates in order and return the first interpreter that runs and
 * reports a version. Version policy (reject/warn) is applied by the caller so
 * an explicit operator override that is too old is rejected rather than
 * silently skipped.
 */
export function resolvePython(
  runner: CommandRunner,
  candidates: PythonCandidate[],
  cwd: string,
): ResolvedPython {
  for (const candidate of candidates) {
    const result = runner(candidate.bin, [...candidate.baseArgs, '-c', VERSION_SNIPPET], cwd);
    if (result.error || result.status !== 0) {
      continue;
    }
    const version = parsePythonVersion(result.stdout);
    if (version) {
      return { candidate, version };
    }
  }
  throw new GateError(
    'No usable Python interpreter found. Set TASKSAIL_PYTHON_312_BIN, TASKSAIL_PYTHON_BIN, or PYTHON_BIN to a Python 3.12+ interpreter.',
  );
}

export interface CommandReport {
  label: string;
  command: string;
  exit: number | null;
  ok: boolean;
  detail?: string;
}

export interface RunSectionOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  venvBin: string | null;
  cwd: string;
  repoRoot: string;
  runner: CommandRunner;
  checkRunner: CheckRunner;
}

export interface RunSectionResult {
  ok: boolean;
  warnings: string[];
  reports: CommandReport[];
}

export async function runSection(
  sectionId: string,
  opts: RunSectionOptions,
): Promise<RunSectionResult> {
  const commands = SECTION_COMMANDS[sectionId];
  if (!commands) {
    throw new GateError(
      `Unknown gate section: ${sectionId}. Expected section-0..section-7 or final.`,
    );
  }

  const candidates = buildPythonCandidates(opts.env, opts.platform, opts.venvBin);
  const resolved = resolvePython(opts.runner, candidates, opts.cwd);
  const classification = classifyVersion(resolved.version);
  if (classification === 'reject') {
    throw new GateError(
      `Resolved Python ${formatVersion(resolved.version)} from ${resolved.candidate.source} is below the minimum supported version 3.12. Set TASKSAIL_PYTHON_312_BIN to a Python 3.12 interpreter.`,
    );
  }

  const warnings: string[] = [];
  if (classification === 'compatible') {
    warnings.push(
      `Using compatible fallback Python ${formatVersion(resolved.version)} from ${resolved.candidate.source}; Python 3.12 is the preferred interpreter.`,
    );
  }

  const reports: CommandReport[] = [];
  for (const command of commands) {
    if (command.kind === 'pytest') {
      const args = [...resolved.candidate.baseArgs, '-m', 'pytest', ...command.paths, '-q'];
      const result = opts.runner(resolved.candidate.bin, args, opts.cwd);
      const ok = !result.error && result.status === 0;
      reports.push({
        label: command.label,
        command: `${resolved.candidate.bin} ${args.join(' ')}`,
        exit: result.status,
        ok,
        detail: result.error ? result.error.message : undefined,
      });
    } else {
      const result = await opts.checkRunner(command.module, opts.repoRoot);
      reports.push({
        label: command.label,
        command: command.module,
        exit: result.ok ? 0 : 1,
        ok: result.ok,
        detail: result.messages.length ? result.messages.join('; ') : undefined,
      });
    }
  }

  const ok = reports.every((r) => r.ok);
  return { ok, warnings, reports };
}

function realRunner(bin: string, args: string[], cwd: string): CommandResult {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf-8', shell: false });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ?? undefined,
  };
}

async function realCheckRunner(
  moduleRef: string,
  repoRoot: string,
): Promise<{ ok: boolean; messages: string[] }> {
  const moduleUrl = new URL(moduleRef, import.meta.url).href;
  const mod = (await import(moduleUrl)) as {
    runCheck?: (root: string) => Promise<{ ok: boolean; messages: string[] }> | { ok: boolean; messages: string[] };
  };
  if (typeof mod.runCheck !== 'function') {
    return { ok: false, messages: [`Module ${moduleRef} does not export runCheck()`] };
  }
  return Promise.resolve(mod.runCheck(repoRoot));
}

function resolveVenvBin(repoRoot: string, platform: NodeJS.Platform): string | null {
  const venvBin =
    platform === 'win32'
      ? path.join(repoRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, '.venv', 'bin', 'python');
  return existsSync(venvBin) ? venvBin : null;
}

async function main(): Promise<void> {
  const sectionId = process.argv[2];
  if (!sectionId) {
    writeProtocolStderr('Usage: osAgnosticismGate <section-0..section-7|final>\n');
    process.exit(1);
  }

  const repoRoot = await findRepoRoot();
  const platform = process.platform;

  try {
    const result = await runSection(sectionId, {
      env: process.env,
      platform,
      venvBin: resolveVenvBin(repoRoot, platform),
      cwd: repoRoot,
      repoRoot,
      runner: realRunner,
      checkRunner: realCheckRunner,
    });

    for (const warning of result.warnings) {
      writeProtocolStderr(`  [WARN] ${warning}\n`);
    }
    if (!result.ok) {
      for (const report of result.reports.filter((report) => !report.ok)) {
        writeProtocolStderr(
          `  [FAIL] ${report.label}: exit ${report.exit ?? 'null'}${report.detail ? ` — ${report.detail}` : ''}\n`,
        );
      }
      writeProtocolStderr(`\nOS-agnosticism gate ${sectionId} failed.\n`);
      process.exit(1);
    }
    writeProtocolStdout(`OS-agnosticism gate ${sectionId} passed.\n`);
  } catch (error) {
    if (error instanceof GateError) {
      writeProtocolStderr(`  [FAIL] ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  runCliBoundary('platform/validation/osAgnosticismGate', main);
}
