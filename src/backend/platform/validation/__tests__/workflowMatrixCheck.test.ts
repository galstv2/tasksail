import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../../core/index.js';
import { runCheck } from '../workflowMatrixCheck.js';

const PASSING_CI = [
  'os: [ubuntu-latest, macos-latest, windows-latest]',
  'os: [ubuntu-latest, macos-latest, windows-latest]',
  "python-version: '3.12'",
  'run: pnpm exec tsx changedDomainFiles.ts --base-sha "${{ github.event.pull_request.base.sha }}"',
  'run: python -m pytest tests/domains/pack_writer -q',
].join('\n');

describe('workflowMatrixCheck', () => {
  it('passes on the real ci.yml after Section 7 hardening', async () => {
    const result = await runCheck(findRepoRoot());
    expect(result.messages).toEqual([]);
    expect(result.ok).toBe(true);
  });

  describe('synthetic ci.yml', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'wfm-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function writeCi(content: string): void {
      const target = path.join(dir, '.github', 'workflows', 'ci.yml');
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    }

    it('accepts a workflow that satisfies every rule', async () => {
      writeCi(PASSING_CI);
      const result = await runCheck(dir);
      expect(result.ok).toBe(true);
    });

    it('flags the misspelled pmse.sha', async () => {
      writeCi(`${PASSING_CI}\n\${{ github.event.pull_request.pmse.sha }}`);
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/pmse\.sha/);
    });

    it('flags continue-on-error weakening', async () => {
      writeCi(`${PASSING_CI}\ncontinue-on-error: true`);
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/continue-on-error/);
    });

    it('flags Bash-only changed-domain discovery', async () => {
      writeCi(`${PASSING_CI}\nmapfile -t changed < <(git diff --name-only base head)`);
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/mapfile|git diff --name-only/);
    });

    it('flags fewer than two 3-OS matrices', async () => {
      writeCi("python-version: '3.12'\nchangedDomainFiles base.sha pack_writer");
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/at least 2/);
    });
  });
});
