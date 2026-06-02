import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentId } from '../../core/types.js';

const { runPython, readFile } = vi.hoisted(() => ({
  runPython: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>('../../core/index.js');
  return {
    ...actual,
    runPython,
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile,
  };
});

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: () => ({
    homeDirName: () => '.copilot',
    agentConfigPaths: () => ({ registry: '.github/copilot/agents/registry.json' }),
    runtimeToProviderAgentId: (agentId: string) => (({
      lily: 'planning-agent',
      alice: 'product-manager',
      dalton: 'software-engineer',
      'dalton-verify': 'software-engineer-verify',
      ron: 'qa',
    } as Record<string, string>)[agentId] ?? agentId),
  }),
}));

import { getActiveProvider } from '../../cli-provider/index.js';
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

  beforeEach(() => {
    vi.clearAllMocks();
    runPython.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    readFile.mockResolvedValue('# Reinforcement Context\n\n- Status: available\n');
  });

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('maps dalton-verify to the software-engineer behavioral base registry id', () => {
    const provider = getActiveProvider('');
    expect(resolveBehavioralBaseRegistryId(provider, 'dalton' as AgentId)).toBe('software-engineer');
    expect(resolveBehavioralBaseRegistryId(provider, 'dalton-verify' as AgentId)).toBe('software-engineer');
    expect(resolveBehavioralBaseRegistryId(provider, 'ron' as AgentId)).toBe('qa');
  });

  it('keeps dalton-verify eligible for conventions, corrections, and reinforcement', () => {
    const provider = getActiveProvider('');
    expect(roleRequiresConventions(provider, 'dalton-verify' as AgentId)).toBe(true);
    expect(roleRequiresCorrections(provider, 'dalton-verify' as AgentId)).toBe(true);
    expect(roleRequiresReinforcement(provider, 'dalton-verify' as AgentId)).toBe(true);
  });

  it('reuses the software-engineer rendered reinforcement context for dalton-verify', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'dalton-verify-reinforcement-'));
    createdRoots.push(repoRoot);

    const result = await resolveReinforcementContext(
      'dalton-verify' as AgentId,
      '/packs/pack-a',
      repoRoot,
    );

    expect(result.status).toBe('available');
    expect(result.injectionEnabled).toBe(true);
    expect(result.contextFile).toBe(path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'reinforcement',
      'software-engineer.md',
    ));
  });
});
