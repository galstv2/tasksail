#!/usr/bin/env node

/**
 * Structural CI workflow-matrix validator used by the OS-agnosticism gate runner
 * (section-7) and runnable standalone.
 *
 * Verifies the supported-OS contract is actually proven by CI: Node AND Python
 * lanes on the Ubuntu/macOS/Windows matrix, Python 3.12 selection, a Windows
 * Python unit lane covering PackWriter, the changed-domain lane routed through
 * the cross-platform changedDomainFiles helper using the correct PR base SHA,
 * and no continue-on-error / Bash-only changed-domain logic that would hide
 * cross-OS failures.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCliBoundary, writeProtocolStderr, writeProtocolStdout } from '../core/index.js';

const OS_MATRIX_RE = /os:\s*\[\s*ubuntu-latest\s*,\s*macos-latest\s*,\s*windows-latest\s*\]/g;

interface Rule {
  pattern: RegExp;
  message: string;
}

const REQUIRE: Rule[] = [
  { pattern: /python-version:\s*['"]?3\.12/, message: 'ci.yml must select Python 3.12.' },
  { pattern: /pull_request\.base\.sha/, message: 'the changed-domain lane must use github.event.pull_request.base.sha.' },
  { pattern: /changedDomainFiles/, message: 'the changed-domain lane must route through the cross-platform changedDomainFiles helper.' },
  { pattern: /pack_writer/, message: 'CI must include a representative Python unit lane covering PackWriter across the OS matrix.' },
];

const FORBID: Rule[] = [
  { pattern: /pull_request\.pmse\.sha/, message: 'ci.yml uses the misspelled github.event.pull_request.pmse.sha; use base.sha.' },
  { pattern: /\bmapfile\b/, message: 'ci.yml still uses a Bash mapfile for changed-domain discovery; route through changedDomainFiles.' },
  { pattern: /git diff --name-only/, message: 'ci.yml still runs Bash `git diff --name-only`; discovery must go through changedDomainFiles.' },
  { pattern: /continue-on-error:\s*true/, message: 'ci.yml sets continue-on-error: true, which hides cross-OS failures.' },
  { pattern: /allow-failure/, message: 'ci.yml uses allow-failure, which hides cross-OS failures.' },
];

export async function runCheck(repoRoot: string): Promise<{ ok: boolean; messages: string[] }> {
  const messages: string[] = [];
  const ciPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');
  if (!existsSync(ciPath)) {
    return { ok: false, messages: ['.github/workflows/ci.yml is missing.'] };
  }
  const ci = readFileSync(ciPath, 'utf-8');

  const matrixCount = (ci.match(OS_MATRIX_RE) ?? []).length;
  if (matrixCount < 2) {
    messages.push(
      `ci.yml must run Node AND Python lanes across the ubuntu/macOS/Windows matrix (found ${matrixCount} 3-OS matrices, need at least 2).`,
    );
  }

  for (const rule of REQUIRE) {
    if (!rule.pattern.test(ci)) {
      messages.push(`ci.yml: ${rule.message}`);
    }
  }
  for (const rule of FORBID) {
    if (rule.pattern.test(ci)) {
      messages.push(`ci.yml: ${rule.message}`);
    }
  }

  return { ok: messages.length === 0, messages };
}

async function main(): Promise<void> {
  const repoRoot = process.argv[2] ?? process.cwd();
  const result = await runCheck(repoRoot);
  if (!result.ok) {
    for (const message of result.messages) {
      writeProtocolStderr(`  [FAIL] ${message}\n`);
    }
    process.exit(1);
  }
  writeProtocolStdout('Workflow matrix policy: OK (Node + Python OS matrices, 3.12, base.sha, no CI weakening).\n');
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  runCliBoundary('platform/validation/workflowMatrixCheck', main);
}
