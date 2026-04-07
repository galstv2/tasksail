import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AgentId } from '../../core/types.js';
import {
  resolveBehavioralBaseRegistryId,
  roleRequiresConventions,
} from '../conventions.js';
import { roleRequiresCorrections } from '../corrections.js';
import {
  resolveReinforcementContext,
  roleRequiresReinforcement,
} from '../reinforcement.js';

describe('Dalton-family behavioral inheritance', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('maps dalton-verify to the software-engineer behavioral base registry id', () => {
    expect(resolveBehavioralBaseRegistryId('dalton' as AgentId)).toBe('software-engineer');
    expect(resolveBehavioralBaseRegistryId('dalton-verify' as AgentId)).toBe('software-engineer');
    expect(resolveBehavioralBaseRegistryId('ron' as AgentId)).toBe('qa');
  });

  it('keeps dalton-verify eligible for conventions, corrections, and reinforcement', () => {
    expect(roleRequiresConventions('dalton-verify' as AgentId)).toBe(true);
    expect(roleRequiresCorrections('dalton-verify' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement('dalton-verify' as AgentId)).toBe(true);
  });

  it('reuses the software-engineer reinforcement memo for dalton-verify', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'dalton-verify-reinforcement-'));
    createdRoots.push(repoRoot);

    const rewardDir = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'glopml',
      'agent-rewards',
    );
    mkdirSync(rewardDir, { recursive: true });
    const rewardPath = path.join(rewardDir, 'software-engineer.md');
    writeFileSync(rewardPath, '# Dalton reinforcement', 'utf-8');

    const result = await resolveReinforcementContext(
      'dalton-verify' as AgentId,
      '/packs/pack-a',
      repoRoot,
    );

    expect(result.status).toBe('available');
    expect(result.injectionEnabled).toBe(true);
    expect(result.contextFile).toBe(rewardPath);
  });
});
