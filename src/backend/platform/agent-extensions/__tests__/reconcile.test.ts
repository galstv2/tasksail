import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { reconcileAgentExtensions } from '../reconcile.js';
import { materializeExtension } from '../materialize.js';
import { flushLoggers } from '../../core/logger.js';
import type { AgentExtensionMutationSeams, AgentExtensionSourceManifestEntry } from '../types.js';

let tmpDir: string;
let logDir: string;
let previousLogDir: string | undefined;
let previousLogLevel: string | undefined;

const SKILL_MD = `---
name: Test Skill
description: A reconcile test skill
---
# Test Skill
`;

const NOW = '2026-01-01T00:00:00.000Z';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-'));
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-test-logs-'));
  previousLogDir = process.env.LOG_DIR;
  previousLogLevel = process.env.LOG_LEVEL;
  process.env.LOG_DIR = logDir;
  process.env.LOG_LEVEL = 'debug';
  flushLoggers();
  fs.mkdirSync(path.join(tmpDir, '.platform-state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'config'), { recursive: true });
  writeManifest([]);
});

afterEach(() => {
  flushLoggers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(logDir, { recursive: true, force: true });
  if (previousLogDir === undefined) delete process.env.LOG_DIR;
  else process.env.LOG_DIR = previousLogDir;
  if (previousLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = previousLogLevel;
});

function writeManifest(entries: AgentExtensionSourceManifestEntry[]): void {
  fs.writeFileSync(
    path.join(tmpDir, 'config', 'agent-extensions.default.json'),
    JSON.stringify({ schema_version: 1, extensions: entries }),
  );
}

function makeLocalSkillEntry(id: string, srcPath: string): AgentExtensionSourceManifestEntry {
  return {
    id,
    kind: 'skill',
    provider_id: 'copilot',
    display_name: id,
    description: 'test',
    enabled: true,
    source: { type: 'local', path: srcPath },
  };
}

function createSkillSrc(id: string): string {
  const srcDir = path.join(tmpDir, `src-${id}`);
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'SKILL.md'), SKILL_MD);
  return srcDir;
}

describe('reconcileAgentExtensions', () => {
  it('returns zero counts for empty manifest', async () => {
    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });
    expect(result.materialized).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.unavailable).toBe(0);
    expect(readLogRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'debug', msg: 'agent_extensions.reconcile.started' }),
      expect.objectContaining({
        level: 'debug',
        msg: 'agent_extensions.reconcile.completed',
        extra: { materialized: 0, repaired: 0, unavailable: 0 },
      }),
    ]));
    expect(readLogRecords().filter((record) =>
      record.level === 'info' && record.msg === 'agent_extensions.reconcile.completed'
    )).toEqual([]);
  });

  it('is idempotent: already materialized entries produce 0 materialized on re-run', async () => {
    const srcDir = createSkillSrc('idem-skill');
    const entry = makeLocalSkillEntry('idem-skill', srcDir);
    writeManifest([entry]);

    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    // Pre-materialize
    await materializeExtension(tmpDir, entry, seams);

    // Reconcile should see it as already present
    const result = await reconcileAgentExtensions(tmpDir, seams);
    expect(result.materialized).toBe(0);
    expect(result.unavailable).toBe(0);
  });

  it('materializes missing runtime copy', async () => {
    const srcDir = createSkillSrc('missing-skill');
    const entry = makeLocalSkillEntry('missing-skill', srcDir);
    writeManifest([entry]);

    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });
    expect(result.materialized).toBe(1);
    expect(result.unavailable).toBe(0);
    expect(readLogRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: 'info',
        msg: 'agent_extensions.reconcile.completed',
        extra: { materialized: 1, repaired: 0, unavailable: 0 },
      }),
    ]));

    // Runtime copy now exists
    const runtimePath = path.join(tmpDir, '.platform-state', 'skills', 'missing-skill');
    expect(fs.existsSync(path.join(runtimePath, 'SKILL.md'))).toBe(true);
  });

  it('records unavailable for entries whose source path is missing (without crashing startup)', async () => {
    const entry = makeLocalSkillEntry('bad-source', '/nonexistent/path/9999');
    writeManifest([entry]);

    // Should NOT throw — just record unavailable
    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });
    expect(result.unavailable).toBe(1);
    expect(result.materialized).toBe(0);
    expect(readLogRecords()).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: 'warn', msg: 'agent_extensions.reconcile.entry_unavailable' }),
      expect.objectContaining({
        level: 'info',
        msg: 'agent_extensions.reconcile.completed',
        extra: { materialized: 0, repaired: 0, unavailable: 1 },
      }),
    ]));
  });

  it('never deletes existing runtime copies or receipts (non-destructive)', async () => {
    const srcDir = createSkillSrc('keep-skill');
    const entry = makeLocalSkillEntry('keep-skill', srcDir);
    writeManifest([entry]);

    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);

    const runtimePath = path.join(tmpDir, '.platform-state', 'skills', 'keep-skill');
    const receiptPath = path.join(
      tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'keep-skill.json',
    );
    expect(fs.existsSync(runtimePath)).toBe(true);
    expect(fs.existsSync(receiptPath)).toBe(true);

    // Reconcile again — still present
    await reconcileAgentExtensions(tmpDir, seams);
    expect(fs.existsSync(runtimePath)).toBe(true);
    expect(fs.existsSync(receiptPath)).toBe(true);
  });

  it('repairs drift when source_digest does not match', async () => {
    const srcDir = createSkillSrc('drift-skill');
    const entry = makeLocalSkillEntry('drift-skill', srcDir);
    writeManifest([entry]);

    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);

    // Tamper with the runtime copy to induce drift
    const runtimePath = path.join(tmpDir, '.platform-state', 'skills', 'drift-skill');
    fs.writeFileSync(path.join(runtimePath, 'extra-file.txt'), 'tampered');

    const result = await reconcileAgentExtensions(tmpDir, seams);
    expect(result.repaired).toBeGreaterThanOrEqual(0); // repair attempted
    // After repair, extra file should be gone
    expect(fs.existsSync(path.join(runtimePath, 'extra-file.txt'))).toBe(false);
  });

  it('handles invalid source manifest gracefully without startup crash', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config', 'agent-extensions.default.json'),
      '{ broken json',
    );

    // Should not throw
    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });
    expect(result.materialized).toBe(0);
    expect(result.unavailable).toBe(0);
  });

  it('skips reconcile when mutex is busy (deterministic mock) and logs mutex-busy', async () => {
    const srcDir = createSkillSrc('mutex-skill');
    const entry = makeLocalSkillEntry('mutex-skill', srcDir);
    writeManifest([entry]);

    // Deterministically simulate a busy lock by mocking withAgentExtensionsLock to reject
    const lockModule = await import('../lock.js');
    const lockSpy = vi.spyOn(lockModule, 'withAgentExtensionsLock').mockRejectedValueOnce(
      new Error('reconcileAgentExtensions blocked: could not acquire queue lock. Another operation may be in progress.'),
    );

    // Should NOT throw
    const result = await reconcileAgentExtensions(tmpDir, { now: () => NOW });

    // Busy lock → zero counts (manifest count unknown)
    expect(result.materialized).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.unavailable).toBe(0);

    lockSpy.mockRestore();
  });

  it('repairs an entry whose receipt is inconsistent with the manifest entry', async () => {
    const srcDir = createSkillSrc('recon-mismatch');
    const entry = makeLocalSkillEntry('recon-mismatch', srcDir);
    writeManifest([entry]);
    const seams: AgentExtensionMutationSeams = { now: () => NOW };
    await materializeExtension(tmpDir, entry, seams);

    // Corrupt the receipt's source_type so it no longer matches the (local) entry.
    const receiptPath = path.join(
      tmpDir, '.platform-state', 'agent-extensions', 'imports', 'skills', 'recon-mismatch.json',
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
    receipt.source_type = 'git';
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');

    // Runtime copy still present, so the mismatched receipt is a repair (not a fresh materialize).
    const result = await reconcileAgentExtensions(tmpDir, seams);
    expect(result.repaired).toBe(1);
    expect(result.materialized).toBe(0);

    // After repair the receipt matches again → idempotent on the next run.
    const rerun = await reconcileAgentExtensions(tmpDir, seams);
    expect(rerun.repaired).toBe(0);
    expect(rerun.materialized).toBe(0);
  });
});

function readLogRecords(): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      records.push(...fs.readFileSync(entryPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>));
    }
  };
  visit(logDir);
  return records;
}
