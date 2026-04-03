import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../archive.js', () => ({
  fileTaskArchive: vi.fn(),
}));

vi.mock('../operations.js', () => ({
  completeActiveItem: vi.fn(),
  acquireDirLockOrThrow: vi.fn(),
}));

vi.mock('../policyValidation.js', () => ({
  assertPolicyPasses: vi.fn(),
}));

vi.mock('../paths.js', () => ({
  resolveQueuePaths: (root: string) => ({
    pendingDir: `${root}/AgentWorkSpace/pendingitems`,
    handoffsDir: `${root}/AgentWorkSpace/handoffs`,
    templatesDir: `${root}/AgentWorkSpace/templates`,
    queueLockDir: `${root}/AgentWorkSpace/pendingitems/.queue-lock.d`,
  }),
}));

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
}));

vi.mock('../../context-pack/index.js', () => ({
  requireAuthorizedActiveContextPack: vi.fn(),
}));

vi.mock('../retrospectiveFlag.js', () => ({
  syncRetrospectiveRequiredMetadata: vi.fn(),
}));

import { fileTaskArchive } from '../archive.js';
import { completeActiveItem, acquireDirLockOrThrow } from '../operations.js';
import { completePendingItem } from '../completePendingItem.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/index.js';
import { syncRetrospectiveRequiredMetadata } from '../retrospectiveFlag.js';

const mockFileTaskArchive = vi.mocked(fileTaskArchive);
const mockCompleteActiveItem = vi.mocked(completeActiveItem);
const mockAcquireDirLockOrThrow = vi.mocked(acquireDirLockOrThrow);
const mockRequireAuthorizedActiveContextPack = vi.mocked(requireAuthorizedActiveContextPack);
const mockSyncRetrospectiveRequiredMetadata = vi.mocked(syncRetrospectiveRequiredMetadata);

describe('completePendingItem archive integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockCompleteActiveItem.mockResolvedValue(undefined);
    mockFileTaskArchive.mockResolvedValue({
      passed: true,
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockSyncRetrospectiveRequiredMetadata.mockResolvedValue(undefined);
    const mockRelease = vi.fn().mockResolvedValue(undefined);
    mockAcquireDirLockOrThrow.mockResolvedValue(mockRelease);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('calls archive when skipArchive is not set and the active context pack is authorized', async () => {
    await completePendingItem({
      skipValidation: true,
      repoRoot: '/fake/repo',
    });

    expect(mockFileTaskArchive).toHaveBeenCalledWith({
      contextPackDir: '/packs/pack-a',
      repoRoot: '/fake/repo',
    });
    expect(mockSyncRetrospectiveRequiredMetadata).toHaveBeenCalledWith({
      repoRoot: '/fake/repo',
      handoffsDir: '/fake/repo/AgentWorkSpace/handoffs',
      contextPackDir: '/packs/pack-a',
    });
    expect(mockCompleteActiveItem).toHaveBeenCalled();
  });

  it('skips archive when skipArchive is true', async () => {
    await completePendingItem({
      skipValidation: true,
      skipArchive: true,
      repoRoot: '/fake/repo',
    });

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
    expect(mockCompleteActiveItem).toHaveBeenCalled();
  });

  it('throws when no authorized active context pack is available', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('No active context pack is configured in repo .env. Activate a context pack before running write operations.'),
    );

    await expect(
      completePendingItem({
        skipValidation: true,
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('No active context pack is configured in repo .env');

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });

  it('throws and blocks completion when archive fails', async () => {
    mockFileTaskArchive.mockResolvedValue({
      passed: false,
      stdout: '',
      stderr: 'archive error',
      exitCode: 1,
    });

    await expect(
      completePendingItem({
        skipValidation: true,
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('Completion blocked: task archival failed');

    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });

  it('throws when queue lock cannot be acquired', async () => {
    mockAcquireDirLockOrThrow.mockRejectedValue(
      new Error('Completion blocked: could not acquire queue lock. Another operation may be in progress.'),
    );

    await expect(
      completePendingItem({
        skipValidation: true,
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('could not acquire queue lock');

    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });

  it('blocks archival when ACTIVE_CONTEXT_PACK_DIR disagrees with repo .env', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack. Refusing write operation.'),
    );

    await expect(
      completePendingItem({
        skipValidation: true,
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack');

    expect(mockFileTaskArchive).not.toHaveBeenCalled();
    expect(mockCompleteActiveItem).not.toHaveBeenCalled();
  });
});
