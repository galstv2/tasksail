import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { publishPendingItem } from '../publishPendingItem.js';
import { resolveQueuePaths } from '../paths.js';
import { acquireDirLockOrThrow } from '../dirLock.js';
import { activateNextPendingItemIfReady, moveDropboxItemsOnce } from '../operations.js';

vi.mock('../dirLock.js', () => ({
  acquireDirLockOrThrow: vi.fn(),
}));

vi.mock('../operations.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../operations.js')>();
  return {
    ...actual,
    activateNextPendingItemIfReady: vi.fn(),
    moveDropboxItemsOnce: vi.fn(),
  };
});

describe('publishPendingItem', () => {
  let repoRoot: string;
  let release: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'publish-pending-item-'));
    release = vi.fn(async () => undefined);
    vi.mocked(acquireDirLockOrThrow).mockResolvedValue(release);
    vi.mocked(activateNextPendingItemIfReady).mockResolvedValue({
      activated: true,
    });
    vi.mocked(moveDropboxItemsOnce).mockResolvedValue(0);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('publishes once, activates once, and returns both outcomes', async () => {
    const publish = vi.fn(async () => '/repo/AgentWorkSpace/pendingitems/task.md');

    const result = await publishPendingItem({
      publish,
      repoRoot,
      contextPackDir: '/contextpacks/orders',
      lockOperationName: 'test.publish',
    });

    expect(acquireDirLockOrThrow).toHaveBeenCalledWith(
      resolveQueuePaths(repoRoot).queueLockDir,
      'test.publish',
    );
    expect(publish).toHaveBeenCalledOnce();
    expect(moveDropboxItemsOnce).toHaveBeenCalledWith(
      resolveQueuePaths(repoRoot).dropboxDir,
      resolveQueuePaths(repoRoot).pendingDir,
    );
    expect(activateNextPendingItemIfReady).toHaveBeenCalledWith({
      paths: expect.objectContaining({
        queueLockDir: resolveQueuePaths(repoRoot).queueLockDir,
        pendingDir: resolveQueuePaths(repoRoot).pendingDir,
      }),
      repoRoot,
      contextPackDir: '/contextpacks/orders',
    });
    expect(result).toEqual({
      destinationPath: '/repo/AgentWorkSpace/pendingitems/task.md',
      activation: { activated: true },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('surfaces activation failures as best-effort activation results', async () => {
    const publish = vi.fn(async () => '/repo/AgentWorkSpace/pendingitems/task.md');
    vi.mocked(activateNextPendingItemIfReady).mockRejectedValue(new Error('boom'));

    await expect(
      publishPendingItem({
        publish,
        repoRoot,
        lockOperationName: 'test.publish',
      }),
    ).resolves.toEqual({
      destinationPath: '/repo/AgentWorkSpace/pendingitems/task.md',
      activation: {
        activated: false,
        reason: 'activation-error: boom',
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('propagates publish failures without attempting activation', async () => {
    const publishError = new Error('publish failed');
    const publish = vi.fn(async () => {
      throw publishError;
    });

    await expect(
      publishPendingItem({
        publish,
        repoRoot,
        lockOperationName: 'test.publish',
      }),
    ).rejects.toThrow(publishError);

    expect(moveDropboxItemsOnce).not.toHaveBeenCalled();
    expect(activateNextPendingItemIfReady).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
