// @vitest-environment node

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function getReapedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  if (typeof pid !== 'number') {
    throw new Error('Failed to spawn child process for stale-pid test');
  }
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  await new Promise<void>((resolve) => setTimeout(resolve, 25));
  return pid;
}

const TEST_REPO_ROOT = join(tmpdir(), `tasksail-vitest-planner-staging-${process.pid}`);

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

    expect(derivePlannerDraftTitle({
      primaryRepoId: 'backend',
      primaryRepoRoot: '/repos/backend',
      primaryFocusRelativePath: 'src/handler.ts',
      primaryFocusTargetKind: 'file',
    })).toBe('backend / src/handler.ts (file)');
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
        estateType: 'distributed',
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'services/orders',
        selectedRepoIds: ['backend'],
        selectedFocusIds: ['orders'],
      },
      now: new Date('2026-01-02T03:04:05.000Z'),
    });

    expect(metadata.draftFilename).toBe('20260102T030405Z_backend-services-orders.md');
    expect(metadata.title).toBe('backend / services/orders');

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

  it('suppresses Primary Repo ID for monolith packs and surfaces only Primary Focus ID', async () => {
    const { initializeStagedPlanningDraft, readOwnedStagedDraft } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-monolith',
      contextPackDir: '/contextpacks/monorepo',
      focusedRepo: {
        estateType: 'monolith',
        primaryRepoId: 'monorepo',
        primaryRepoRoot: '/repos/monorepo',
        primaryFocusId: 'platform-service',
        primaryFocusRelativePath: 'platform',
        selectedRepoIds: ['monorepo'],
        selectedFocusIds: ['platform-service'],
      },
      now: new Date('2026-03-04T05:06:07.000Z'),
    });

    const { draft } = await readOwnedStagedDraft('planner-monolith');
    expect(draft?.content).not.toContain('- Primary Repo ID:');
    // Monolith has no repo-selection concept; the line would just echo Context
    // Pack ID. Staging passes [] and the emitter skips the line entirely.
    expect(draft?.content).not.toContain('- Selected Repo IDs:');
    expect(draft?.content).toContain('- Primary Focus ID: platform-service');
  });

  it('persists Deep Focus staging metadata for planner-originated drafts', async () => {
    const {
      initializeStagedPlanningDraft,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-109',
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        estateType: 'distributed',
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'src/handler.ts',
        deepFocusEnabled: true,
        primaryFocusTargetKind: 'file',
        selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
        supportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
        selectedRepoIds: ['backend'],
        selectedFocusIds: [],
      },
      now: new Date('2026-02-09T10:11:12.000Z'),
    });

    const { draft } = await (await import('../main.staging')).readOwnedStagedDraft('planner-109');
    expect(draft?.content).toContain('- Deep Focus Enabled: true');
    expect(draft?.content).toContain('- Selected Focus Path: src/handler.ts');
    expect(draft?.content).toContain('- Selected Test Target: {"path":"tests/handler.test.ts","kind":"file"}');
    // Deep focus encodes the operator's selection in Selected Focus Targets;
    // these two labels are duplicate/empty noise in this mode and should be
    // suppressed.
    expect(draft?.content).not.toContain('- Primary Repo ID:');
    expect(draft?.content).not.toContain('- Selected Focus IDs:');

    await expect(readPlannerStagingSidecar()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-109',
      deepFocusEnabled: true,
      primaryFocusRelativePath: 'src/handler.ts',
      primaryFocusTargetKind: 'file',
      selectedTestTarget: { path: 'tests/handler.test.ts', kind: 'file' },
      supportTargets: [{ path: 'docs', kind: 'directory', effectiveScope: 'full-directory' }],
    }));
  });

  it('carries scoped primary fields through the planner staging sidecar', async () => {
    const {
      initializeStagedPlanningDraft,
      readPlannerStagingSidecar,
    } = await import('../main.staging');

    await initializeStagedPlanningDraft({
      sessionId: 'planner-110',
      contextPackDir: '/contextpacks/orders',
      focusedRepo: {
        estateType: 'distributed',
        primaryRepoId: 'backend',
        primaryRepoRoot: '/repos/backend',
        primaryFocusRelativePath: 'src/orders',
        deepFocusEnabled: true,
        primaryFocusTargetKind: 'directory',
        primaryFocusTargets: [
          {
            path: 'src/orders',
            kind: 'directory',
            role: 'anchor',
            testTarget: { path: 'tests/orders', kind: 'directory' },
            supportTargets: [{ path: 'docs/orders', kind: 'directory' }],
          } as never,
        ],
        selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders', kind: 'directory', effectiveScope: 'full-directory' }],
        selectedRepoIds: ['backend'],
        selectedFocusIds: [],
      },
      now: new Date('2026-02-09T10:11:13.000Z'),
    });

    await expect(readPlannerStagingSidecar()).resolves.toEqual(expect.objectContaining({
      primaryFocusTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
          supportTargets: [{ path: 'docs/orders', kind: 'directory' }],
        },
      ],
      contextPackBinding: expect.objectContaining({
        selectedFocusTargets: [
          {
            path: 'src/orders',
            kind: 'directory',
            role: 'anchor',
            testTarget: { path: 'tests/orders', kind: 'directory' },
            supportTargets: [{ path: 'docs/orders', kind: 'directory' }],
          },
        ],
      }),
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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
        estateType: 'distributed',
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

  it('reclaims an orphaned planner staging lock when the holder process is dead', async () => {
    const {
      acquirePlannerStagingLock,
      readPlannerStagingLockOwnership,
    } = await import('../main.staging');

    const stagingDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox', '.staging');
    const lockDir = join(stagingDir, '.planner-lock.d');
    await mkdir(lockDir, { recursive: true });

    const deadPid = await getReapedPid();
    await writeFile(
      join(lockDir, 'owner.json'),
      JSON.stringify({ version: 1, sessionId: 'planner-orphan', acquiredAt: '2026-01-01T00:00:00Z', pid: deadPid }, null, 2) + '\n',
      'utf-8',
    );

    const ownership = await acquirePlannerStagingLock('planner-301', { maxRetries: 2, backoffMs: 10 });
    expect(ownership.sessionId).toBe('planner-301');
    expect(ownership.pid).toBe(process.pid);

    await expect(readPlannerStagingLockOwnership()).resolves.toEqual(expect.objectContaining({
      sessionId: 'planner-301',
      pid: process.pid,
    }));
  });

  it('does not reclaim the planner staging lock when the holder process is alive', async () => {
    const { acquirePlannerStagingLock } = await import('../main.staging');

    const stagingDir = join(TEST_REPO_ROOT, 'AgentWorkSpace', 'dropbox', '.staging');
    const lockDir = join(stagingDir, '.planner-lock.d');
    await mkdir(lockDir, { recursive: true });

    await writeFile(
      join(lockDir, 'owner.json'),
      JSON.stringify({ version: 1, sessionId: 'planner-alive', acquiredAt: '2026-01-01T00:00:00Z', pid: process.pid }, null, 2) + '\n',
      'utf-8',
    );

    await expect(
      acquirePlannerStagingLock('planner-302', { maxRetries: 1, backoffMs: 1 }),
    ).rejects.toThrow('planner-alive');
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
