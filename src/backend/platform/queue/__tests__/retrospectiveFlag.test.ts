import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getRetrospectiveRequiredForNextTask,
  isRetrospectiveRequiredForCompletedCount,
  syncRetrospectiveRequiredMetadata,
} from '../retrospectiveFlag.js';

describe('retrospectiveFlag', () => {
  let repoRoot: string;
  let handoffsDir: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'retro-flag-'));
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('requires retrospective only for every tenth task position', () => {
    expect(isRetrospectiveRequiredForCompletedCount(0)).toBe(false);
    expect(isRetrospectiveRequiredForCompletedCount(8)).toBe(false);
    expect(isRetrospectiveRequiredForCompletedCount(9)).toBe(true);
    expect(isRetrospectiveRequiredForCompletedCount(10)).toBe(false);
  });

  it('reads the next-task requirement from the context-pack counter', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-a.json'),
      JSON.stringify({ completed_count: 9 }, null, 2),
      'utf-8',
    );

    await expect(getRetrospectiveRequiredForNextTask({
      repoRoot,
      contextPackDir: '/packs/pack-a',
    })).resolves.toBe(true);
  });

  it('synchronizes Retrospective Required metadata from the counter', async () => {
    const counterDir = path.join(repoRoot, '.platform-state', 'task-counters');
    mkdirSync(counterDir, { recursive: true });
    writeFileSync(
      path.join(counterDir, 'pack-a.json'),
      JSON.stringify({ completed_count: 0 }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(handoffsDir, 'retrospective-input.md'),
      '# Retrospective Input\n\n## Task Metadata\n\n- Retrospective Required:\n  true\n',
      'utf-8',
    );

    await syncRetrospectiveRequiredMetadata({
      repoRoot,
      handoffsDir,
      contextPackDir: '/packs/pack-a',
    });

    const content = await import('node:fs/promises').then((fs) => fs.readFile(
      path.join(handoffsDir, 'retrospective-input.md'),
      'utf-8',
    ));
    expect(content).toContain('- Retrospective Required: false');
    expect(content).not.toContain('\n  true');
  });
});
