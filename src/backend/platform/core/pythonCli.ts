#!/usr/bin/env node

/**
 * Cross-platform Python entrypoint for package scripts.
 *
 * Resolves a Python interpreter that strongly prefers Python 3.12, accepts a
 * compatible version above 3.12 (with a warning) only when 3.12 is unavailable,
 * and rejects anything below 3.12. Forwards argv without shell interpolation and
 * exits with the child's exit code. Used by package.json scripts instead of a
 * hardcoded `python3`, which Windows hosts frequently lack.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from './paths.js';
import { runCliBoundary } from './cliBoundary.js';
import { writeProtocolStderr } from './protocolOutput.js';
import {
  buildInterpreterCandidates,
  classifyPythonVersion,
  formatPythonVersion,
  resolveInterpreter,
} from './pythonResolver.js';
export {
  buildInterpreterCandidates,
  classifyPythonVersion,
  formatPythonVersion,
  parsePythonVersion,
  resolveInterpreter,
  resolveRuntimePython,
} from './pythonResolver.js';
export type {
  PythonInterpreterCandidate,
  PythonVersion,
  PythonVersionClass,
  ResolvedInterpreter,
  ResolveRuntimePythonOptions,
  VersionProbe,
} from './pythonResolver.js';

async function main(): Promise<void> {
  const forwarded = process.argv.slice(2);
  let repoRoot: string | undefined;
  try {
    repoRoot = findRepoRoot();
  } catch {
    repoRoot = undefined;
  }
  const candidates = buildInterpreterCandidates(process.env, process.platform, repoRoot);
  const resolved = resolveInterpreter(candidates);
  const classification = classifyPythonVersion(resolved.version);

  if (classification === 'reject') {
    writeProtocolStderr(
      `  [FAIL] Resolved Python ${formatPythonVersion(resolved.version)} from ${resolved.candidate.source} is below the minimum supported version 3.12. Set TASKSAIL_PYTHON_312_BIN to a Python 3.12 interpreter.\n`,
    );
    process.exit(1);
  }
  if (classification === 'compatible') {
    writeProtocolStderr(
      `  [WARN] Using compatible fallback Python ${formatPythonVersion(resolved.version)} from ${resolved.candidate.source}; Python 3.12 is the preferred interpreter.\n`,
    );
  }

  const child = spawn(resolved.candidate.bin, [...resolved.candidate.baseArgs, ...forwarded], {
    stdio: 'inherit',
    shell: false,
  });
  child.on('error', (err: Error) => {
    writeProtocolStderr(`  [FAIL] Failed to launch Python: ${err.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  runCliBoundary('platform/core/pythonCli', main);
}
