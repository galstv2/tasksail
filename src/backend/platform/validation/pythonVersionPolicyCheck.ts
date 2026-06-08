#!/usr/bin/env node

/**
 * Deterministic Python-version policy scanner used by the OS-agnosticism gate
 * runner and runnable standalone.
 *
 * Policy: Python 3.12 is the preferred/default interpreter and the compatibility
 * floor; Python below 3.12 is rejected; Python above 3.12 is a compatible
 * fallback only. This scan flags stale Python 3.11 floors, Python 3.13 stated as
 * the default/stack interpreter, container base images off 3.12, a preflight
 * minimum that is not 3.12, and package scripts that invoke `python3` directly
 * instead of the cross-platform pythonCli wrapper. Platform-conditional resolver
 * fallbacks (e.g. detectPythonBin / localSetup `python3` vs `python`) are
 * intentionally not scanned.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCliBoundary } from '../core/index.js';
import { writeProtocolStderr, writeProtocolStdout } from '../core/index.js';

interface PolicyRule {
  file: string;
  /** A match is a violation. */
  forbid?: { pattern: RegExp; message: string }[];
  /** Absence (when the file exists) is a violation. */
  require?: { pattern: RegExp; message: string }[];
}

const RULES: PolicyRule[] = [
  {
    file: 'README.md',
    forbid: [
      { pattern: /3\.11/, message: 'README.md references Python 3.11 (the 3.12 floor removed it).' },
      { pattern: /Python 3\.13/, message: 'README.md states Python 3.13 as the interpreter; use Python 3.12 (preferred) / 3.12+ (compatible).' },
    ],
    require: [{ pattern: /3\.12/, message: 'README.md must state Python 3.12 as the preferred interpreter.' }],
  },
  {
    file: 'docs/getting-started/01-install-prerequisites.md',
    forbid: [
      { pattern: /3\.11/, message: 'docs/getting-started/01-install-prerequisites.md references Python 3.11.' },
      { pattern: /Python 3\.13/, message: 'docs/getting-started/01-install-prerequisites.md states Python 3.13 as the interpreter; use Python 3.12.' },
    ],
    require: [{ pattern: /3\.12/, message: 'docs/getting-started/01-install-prerequisites.md must state Python 3.12 as the preferred interpreter.' }],
  },
  {
    file: 'docs/technical/operations/container-runtime.md',
    forbid: [
      { pattern: /3\.11/, message: 'docs/technical/operations/container-runtime.md references Python 3.11.' },
      { pattern: /Python 3\.13/, message: 'docs/technical/operations/container-runtime.md states Python 3.13 as the interpreter; use Python 3.12.' },
    ],
    require: [{ pattern: /3\.12/, message: 'docs/technical/operations/container-runtime.md must state Python 3.12 as the preferred interpreter.' }],
  },
  {
    file: '.claude/CLAUDE.md',
    forbid: [
      { pattern: /3\.11/, message: '.claude/CLAUDE.md references Python 3.11.' },
      { pattern: /Python 3\.13/, message: '.claude/CLAUDE.md states Python 3.13 as the interpreter; use Python 3.12 preferred / 3.12+ compatible.' },
    ],
    require: [{ pattern: /3\.12/, message: '.claude/CLAUDE.md must state Python 3.12 as the preferred interpreter.' }],
  },
  {
    file: 'runtime/docker/repo-context-mcp/Dockerfile',
    forbid: [{ pattern: /python:3\.(11|13)/, message: 'Docker base image is not Python 3.12.' }],
    require: [{ pattern: /python:3\.12/, message: 'Docker base image must be python:3.12.' }],
  },
  {
    file: 'runtime/podman/repo-context-mcp/Containerfile',
    forbid: [{ pattern: /python:3\.(11|13)/, message: 'Podman base image is not Python 3.12.' }],
    require: [{ pattern: /python:3\.12/, message: 'Podman base image must be python:3.12.' }],
  },
  {
    file: 'src/backend/mcp/pack/preflight.py',
    forbid: [
      { pattern: /PYTHON_MIN_VERSION[^\n]*\(\s*3\s*,\s*(11|13)\s*\)/, message: 'pack_preflight.py PYTHON_MIN_VERSION is not (3, 12).' },
    ],
    require: [{ pattern: /PYTHON_MIN_VERSION[^\n]*\(\s*3\s*,\s*12\s*\)/, message: 'pack_preflight.py must set PYTHON_MIN_VERSION to (3, 12).' }],
  },
  {
    file: 'package.json',
    forbid: [{ pattern: /"\s*python3\s/, message: 'package.json invokes python3 directly; route Python scripts through pythonCli.ts.' }],
  },
  {
    file: '.github/workflows/ci.yml',
    forbid: [{ pattern: /python-version:\s*['"]?3\.(11|13)/, message: 'ci.yml selects a stale Python version (must exercise 3.12).' }],
    require: [{ pattern: /python-version:\s*['"]?3\.12/, message: 'ci.yml must exercise Python 3.12.' }],
  },
];

export async function runCheck(repoRoot: string): Promise<{ ok: boolean; messages: string[] }> {
  const messages: string[] = [];
  for (const rule of RULES) {
    const filePath = path.join(repoRoot, rule.file);
    if (!existsSync(filePath)) {
      continue;
    }
    const content = readFileSync(filePath, 'utf-8');
    for (const forbidden of rule.forbid ?? []) {
      if (forbidden.pattern.test(content)) {
        messages.push(`${rule.file}: ${forbidden.message}`);
      }
    }
    for (const required of rule.require ?? []) {
      if (!required.pattern.test(content)) {
        messages.push(`${rule.file}: ${required.message}`);
      }
    }
  }

  // Agent instruction docs are discovered by glob so this scanner stays
  // provider-agnostic and contains no provider-name
  // literal; the filename is read from disk, not hardcoded.
  const githubDir = path.join(repoRoot, '.github');
  if (existsSync(githubDir)) {
    for (const entry of readdirSync(githubDir)) {
      if (!entry.endsWith('-instructions.md')) {
        continue;
      }
      const content = readFileSync(path.join(githubDir, entry), 'utf-8');
      if (/3\.11/.test(content)) {
        messages.push(`.github/${entry}: references Python 3.11.`);
      }
      if (/Python 3\.13/.test(content)) {
        messages.push(`.github/${entry}: states Python 3.13 as the interpreter; use Python 3.12.`);
      }
    }
  }

  return { ok: messages.length === 0, messages };
}

async function main(): Promise<void> {
  const repoRootArg = process.argv[2];
  const repoRoot = repoRootArg ?? process.cwd();
  const result = await runCheck(repoRoot);
  if (!result.ok) {
    for (const message of result.messages) {
      writeProtocolStderr(`  [FAIL] ${message}\n`);
    }
    process.exit(1);
  }
  writeProtocolStdout('Python version policy: OK (3.12 preferred, no stale 3.11/3.13 defaults).\n');
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  runCliBoundary('platform/validation/pythonVersionPolicyCheck', main);
}
