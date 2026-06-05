import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- hoisted mocks ---
const { readdirMock, readFileMock } = vi.hoisted(() => ({
  readdirMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: readdirMock,
  readFile: readFileMock,
}));

vi.mock('../../core/index.js', () => ({
  findRepoRoot: () => '/fake/repo',
}));

// Provide reinforcementPaths stubs so module loads without real FS.
vi.mock('../reinforcementPaths.js', () => ({
  agentRewardsDir: (repoRoot: string) => `${repoRoot}/.platform-state/runtime/reinforcement/agents`,
  legacyAgentRewardsDir: (repoRoot: string) => `${repoRoot}/.platform-state/runtime/reinforcement`,
  readJsonSafe: vi.fn().mockResolvedValue(null),
  readStoreJsonSafe: vi.fn().mockResolvedValue(null),
}));

const agentConfigPathsReturn = { registry: '.github/agents/registry.json' };
const getActiveProviderMock = vi.fn((_repoRoot?: string) => ({
  agentConfigPaths: () => agentConfigPathsReturn,
}));

vi.mock('../../cli-provider/index.js', () => ({
  getActiveProvider: (repoRoot?: string) => getActiveProviderMock(repoRoot),
}));

import path from 'node:path';
import { readAgentRewards } from '../reinforcementRead.js';
import { readJsonSafe } from '../reinforcementPaths.js';

// Build a minimal registry JSON buffer for test scenarios.
function registryJson(agents: { agent_id: string; reward_multiplier?: number }[]): string {
  return JSON.stringify({ schema_version: 1, agents });
}

// Build a per-agent sidecar JSON record.
function sidecardRecord(agentId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agent_id: agentId,
    role: 'Test Role',
    lifetime_reward: 100,
    unrewarded_task_count: 2,
    unrewarded_reward_total: 50,
    ...extra,
  });
}

describe('readAgentRewards — reward_multiplier from registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no sidecar files found.
    readdirMock.mockResolvedValue([]);
    // Default: registry returns empty agents list.
    readFileMock.mockResolvedValue(registryJson([]));
  });

  it('resolves registry path via getActiveProvider().agentConfigPaths().registry — no hardcoded path', async () => {
    const repoRoot = '/my/repo';
    readFileMock.mockResolvedValue(registryJson([{ agent_id: 'test-agent', reward_multiplier: 2.0 }]));

    await readAgentRewards(repoRoot);

    // getActiveProvider must have been called with repoRoot
    expect(getActiveProviderMock).toHaveBeenCalledWith(repoRoot);

    // readFile must have been called with the provider-resolved path, not a hardcoded string
    const expectedPath = path.join(repoRoot, agentConfigPathsReturn.registry);
    expect(readFileMock).toHaveBeenCalledWith(expectedPath, 'utf-8');
  });

  it('uses reward_multiplier from registry when sidecar present', async () => {
    const repoRoot = '/fake/repo';
    const agentId = 'product-manager';
    const registryMultiplier = 1.5;

    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('registry.json')) {
        return Promise.resolve(registryJson([{ agent_id: agentId, reward_multiplier: registryMultiplier }]));
      }
      return Promise.resolve(sidecardRecord(agentId));
    });

    // Return a sidecar file from the canonical agents dir
    readdirMock.mockResolvedValue([`${agentId}.json`]);
    (readJsonSafe as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_id: agentId,
      role: 'Product Manager',
      lifetime_reward: 200,
      unrewarded_task_count: 1,
      unrewarded_reward_total: 30,
      multiplier: 99, // sidecar value must be ignored — registry is authoritative
    });

    const summaries = await readAgentRewards(repoRoot);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].agentId).toBe(agentId);
    // Must equal the registry value, not the sidecar multiplier (99) or any hardcoded const
    expect(summaries[0].multiplier).toBe(registryMultiplier);
  });

  it('defaults to 1.0 when reward_multiplier is missing from registry entry', async () => {
    const repoRoot = '/fake/repo';
    const agentId = 'new-agent';

    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('registry.json')) {
        // Agent entry exists but no reward_multiplier field
        return Promise.resolve(registryJson([{ agent_id: agentId }]));
      }
      return Promise.resolve(sidecardRecord(agentId));
    });

    readdirMock.mockResolvedValue([`${agentId}.json`]);
    (readJsonSafe as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_id: agentId,
      role: 'New Role',
      lifetime_reward: 0,
      unrewarded_task_count: 0,
      unrewarded_reward_total: 0,
    });

    const summaries = await readAgentRewards(repoRoot);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].multiplier).toBe(1.0);
  });

  it('defaults to 1.0 when agent is absent from the registry entirely', async () => {
    const repoRoot = '/fake/repo';
    const agentId = 'unknown-agent';

    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('registry.json')) {
        // Registry has a different agent; this agent is not listed
        return Promise.resolve(registryJson([{ agent_id: 'other-agent', reward_multiplier: 2.0 }]));
      }
      return Promise.resolve(sidecardRecord(agentId));
    });

    readdirMock.mockResolvedValue([`${agentId}.json`]);
    (readJsonSafe as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_id: agentId,
      role: 'Unknown',
      lifetime_reward: 0,
      unrewarded_task_count: 0,
      unrewarded_reward_total: 0,
    });

    const summaries = await readAgentRewards(repoRoot);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].multiplier).toBe(1.0);
  });

  it('defaults to 1.0 when registry file is unreadable', async () => {
    const repoRoot = '/fake/repo';
    const agentId = 'software-engineer';

    readFileMock.mockImplementation((filePath: string) => {
      if (filePath.endsWith('registry.json')) {
        return Promise.reject(new Error('ENOENT'));
      }
      return Promise.resolve(sidecardRecord(agentId));
    });

    readdirMock.mockResolvedValue([`${agentId}.json`]);
    (readJsonSafe as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_id: agentId,
      role: 'Software Engineer',
      lifetime_reward: 0,
      unrewarded_task_count: 0,
      unrewarded_reward_total: 0,
    });

    const summaries = await readAgentRewards(repoRoot);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].multiplier).toBe(1.0);
  });
});
