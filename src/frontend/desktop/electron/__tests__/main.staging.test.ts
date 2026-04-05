// @vitest-environment node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_REPO_ROOT = join(process.cwd(), 'scratchspace', 'vitest-planner-staging');

vi.mock('../paths', () => ({
  REPO_ROOT: TEST_REPO_ROOT,
}));

describe('planner staging helpers', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(TEST_REPO_ROOT, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(TEST_REPO_ROOT, { recursive: true, force: true });
  });

  it('derives deterministic planner titles from repo and focus metadata', async () => {
    const { derivePlannerDraftTitle } = await import('../main.staging');

    expect(derivePlannerDraftTitle({
      primaryRepoId: 'backend',
      primaryRepoRoot: '/repos/backend',
      primaryFocusRelativePath: 'services/orders',
    })).toBe('backend / services/orders');

    expect(derivePlannerDraftTitle({
      primaryRepoId: '',
      primaryRepoRoot: '/repos/payments',
    })).toBe('payments');
  });

  it('initializes an owned staged shell with sidecar metadata and lock ownership', async () => {
    const {
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
      readPlannerStagingLockOwnership,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    const metadata = await initializeStagedPlanningDraft({
      sessionId: 'planner-101',
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'services/orders',
        selectedRepoIds: ['backend'],
        selectedFocusIds: ['orders'],
      },
      now: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(metadata.title).toBe('backend / services/orders');
    expect(metadata.draftFilename).toBe('20260102T030405Z_backend-services-orders.md');

    const readResult = await readOwnedStagedDraft('planner-101');
    expect(readResult.error).toBeNull();
    expect(readResult.metadata?.sessionId).toBe('planner-101');
    expect(readResult.draft).toEqual(expect.objectContaining({
      filename: '20260102T030405Z_backend-services-orders.md',
    }));
    expect(readResult.draft?.content).toContain('# backend / services/orders');
    expect(readResult.draft?.content).toContain('- Context Pack Dir: /contextpacks/orders');
    expect(readResult.draft?.content).toContain('- Selected Focus IDs: orders');
    expect(readResult.draft?.content).toContain('- Recommended Execution:');
    expect(readResult.draft?.content).toContain('- Task Kind: standard');

    await expect(readPlannerStagingSidecar()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-101',
      title: 'backend / services/orders',
    }));
    await expect(readPlannerStagingLockOwnership()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-101',
    }));
  });

  it('derives child-task lineage defaults during staged draft initialization', async () => {
    const {
      initializeStagedPlanningDraft,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    const metadata = await initializeStagedPlanningDraft({
      sessionId: 'planner-104',
      contextPackDir: '/contextpacks/platform',
      focusedRepo: {
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
        primaryFocusRelativePath: 'ops',
        selectedRepoIds: ['platform'],
        selectedFocusIds: ['ops'],
      },
      lineage: {
        taskKind: 'child-task',
        parentTaskId: 'PARENT-104',
        followUpReason: 'Continue validation',
      },
      now: new Date('2026-02-04T05:06:07.000Z'),
    });

    expect(metadata.lineage).toEqual({
      taskKind: 'child-task',
      parentTaskId: 'PARENT-104',
      rootTaskId: 'PARENT-104',
      parentQmdRecordId: '',
      parentQmdScope: '',
      followUpReason: 'Continue validation',
    });

    await expect(readPlannerStagingSidecar()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-104',
      draftFilename: '20260204T050607Z_platform-ops.md',
      lineage: expect.objectContaining({
        rootTaskId: 'PARENT-104',
      }),
    }));
  });

  it('prefers the owned staged draft over stray markdown files', async () => {
    const {
      initializeStagedPlanningDraft,
      readStagedDraft,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-102',
      focusedRepo: {
        primaryRepoId: 'frontend',
        primaryRepoRoot: '/repos/frontend',
        primaryFocusRelativePath: undefined,
        selectedRepoIds: ['frontend'],
        selectedFocusIds: [],
      },
      now: new Date('2026-02-03T04:05:06.000Z'),
    });

    const stagingDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox', '.staging');
    await writeFile(join(stagingDir, 'legacy-newer-file.md'), '# wrong draft\n', 'utf-8');

    await expect(readStagedDraft()).resolves.toEqual({
      draft: expect.objectContaining({
        filename: '20260203T040506Z_frontend.md',
      }),
      error: null,
    });
  });

  it('returns a deterministic ownership error when another session reads the staged draft', async () => {
    const {
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-150',
      focusedRepo: {
        primaryRepoId: 'frontend',
        primaryRepoRoot: '/repos/frontend',
        primaryFocusRelativePath: 'desktop',
        selectedRepoIds: ['frontend'],
        selectedFocusIds: ['desktop'],
      },
    });

    await expect(readOwnedStagedDraft('planner-151')).resolves.toEqual({
      draft: null,
      error: 'Staged planner draft is owned by session planner-150, not planner-151.',
      metadata: expect.objectContaining({
        sessionId: 'planner-150',
      }),
    });
  });

  it('reports an empty owned draft without losing metadata context', async () => {
    const {
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
    } = await import('../main.staging');

    const metadata = await initializeStagedPlanningDraft({
      sessionId: 'planner-152',
      focusedRepo: {
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'services/api',
        selectedRepoIds: ['backend'],
        selectedFocusIds: ['api'],
      },
    });

    await writeFile(metadata.draftPath, '   \n', 'utf-8');

    await expect(readOwnedStagedDraft('planner-152')).resolves.toEqual({
      draft: null,
      error: `Staged draft ${metadata.draftFilename} is empty. Ask Lily to rewrite the draft before finalizing.`,
      metadata: expect.objectContaining({
        sessionId: 'planner-152',
        draftFilename: metadata.draftFilename,
      }),
    });
  });

  it('removes staged drafts, sidecars, and owned locks during cleanup', async () => {
    const {
      clearStagingArtifacts,
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
      readPlannerStagingLockOwnership,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-103',
      focusedRepo: {
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
        primaryFocusRelativePath: undefined,
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
      },
    });

    await clearStagingArtifacts({ sessionId: 'planner-103' });

    await expect(readOwnedStagedDraft('planner-103')).resolves.toEqual({
      draft: null,
      error: null,
      metadata: null,
    });
    await expect(readPlannerStagingSidecar()).resolves.toBeNull();
    await expect(readPlannerStagingLockOwnership()).resolves.toBeNull();
  });

  it('does not let a different session clear another planner session staging artifacts', async () => {
    const {
      clearStagingArtifacts,
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
      readPlannerStagingLockOwnership,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-180',
      focusedRepo: {
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
        primaryFocusRelativePath: undefined,
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
      },
    });

    await clearStagingArtifacts({ sessionId: 'planner-181' });

    await expect(readOwnedStagedDraft('planner-180')).resolves.toEqual(expect.objectContaining({
      error: null,
      metadata: expect.objectContaining({
        sessionId: 'planner-180',
      }),
    }));
    await expect(readPlannerStagingLockOwnership()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-180',
    }));
  });

  it('does not delete staged artifacts when cleanup lacks ownership context for an active lock', async () => {
    const {
      clearStagingArtifacts,
      initializeStagedPlanningDraft,
      readOwnedStagedDraft,
      readPlannerStagingLockOwnership,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-181',
      focusedRepo: {
        primaryRepoId: 'platform',
        primaryRepoRoot: '/repos/platform',
        primaryFocusRelativePath: 'ops',
        selectedRepoIds: ['platform'],
        selectedFocusIds: ['ops'],
      },
    });

    await clearStagingArtifacts({});

    await expect(readOwnedStagedDraft('planner-181')).resolves.toEqual(expect.objectContaining({
      error: null,
      metadata: expect.objectContaining({
        sessionId: 'planner-181',
      }),
    }));
    await expect(readPlannerStagingSidecar()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-181',
    }));
    await expect(readPlannerStagingLockOwnership()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-181',
    }));
  });

  it('blocks concurrent staging ownership until the current session releases the lock', async () => {
    const {
      acquirePlannerStagingLock,
      releasePlannerStagingLock,
    } = await import('../main.staging');

    await acquirePlannerStagingLock('planner-201');
    await expect(
      acquirePlannerStagingLock('planner-202', { maxRetries: 1, backoffMs: 1 }),
    ).rejects.toThrow('planner-201');
    await expect(releasePlannerStagingLock()).resolves.toBe(false);
    await expect(releasePlannerStagingLock('planner-202')).resolves.toBe(false);
    await expect(releasePlannerStagingLock('planner-201')).resolves.toBe(true);
  });

  it('falls back to legacy newest-file reads when no sidecar exists', async () => {
    const { readStagedDraft } = await import('../main.staging');
    const stagingDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox', '.staging');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, 'legacy.md'), '# legacy draft\n', 'utf-8');

    const result = await readStagedDraft();
    expect(result.error).toBeNull();
    expect(result.draft?.filename).toBe('legacy.md');
    expect(result.draft?.content).toBe('# legacy draft\n');

    const onDisk = await readFile(join(stagingDir, 'legacy.md'), 'utf-8');
    expect(onDisk).toBe('# legacy draft\n');
  });

  it('does not fall back to legacy newest-file reads for session-aware draft access', async () => {
    const { readStagedDraft } = await import('../main.staging');
    const stagingDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox', '.staging');
    await mkdir(stagingDir, { recursive: true });
    await writeFile(join(stagingDir, 'legacy.md'), '# legacy draft\n', 'utf-8');

    await expect(readStagedDraft('planner-legacy')).resolves.toEqual({
      draft: null,
      error: null,
    });
  });
});
