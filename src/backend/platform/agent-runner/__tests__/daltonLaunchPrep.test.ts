import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusedRepoResult } from '../../context-pack/focusedRepo.js';

vi.mock('../confinement.js', () => ({
  captureChangedPathsSnapshot: vi.fn(),
  validateDaltonBoundaryChanges: vi.fn(),
  DaltonConfinementError: class DaltonConfinementError extends Error {
    violationPaths: string[];

    constructor(message: string, violationPaths: string[]) {
      super(message);
      this.violationPaths = violationPaths;
    }
  },
}));

vi.mock('../../queue/taskJson.js', () => ({
  readTaskJsonSafe: vi.fn(),
}));

const {
  buildArtifactCleanupPrompt,
  prepareDaltonBoundary,
  resolveDaltonBoundaryMonitorRoots,
  validateDaltonPostRunBoundary,
} = await import('../daltonLaunchPrep.js');
const { captureChangedPathsSnapshot, validateDaltonBoundaryChanges } = await import('../confinement.js');
const { readTaskJsonSafe } = await import('../../queue/taskJson.js');

const mockedCaptureChangedPathsSnapshot = vi.mocked(captureChangedPathsSnapshot);
const mockedValidateDaltonBoundaryChanges = vi.mocked(validateDaltonBoundaryChanges);
const mockedReadTaskJsonSafe = vi.mocked(readTaskJsonSafe);

function makeFocused(overrides: Partial<FocusedRepoResult> = {}): FocusedRepoResult {
  return {
    primaryRepoRoot: '/task/worktrees/app',
    visibleRepoRoots: ['/task/worktrees/app'],
    declaredRepoRoots: ['/live/app', '/live/support'],
    estateType: 'distributed-platform',
    primaryRepoId: 'app',
    selectedRepoIds: ['app'],
    selectedFocusIds: [],
    authoritySource: 'active-task-sidecar',
    ...overrides,
  };
}

function makeSidecar(options: {
  repoBindings?: Array<{ originalRoot: string; worktreeRoot: string }>;
  readonlyContextBindings?: Array<{ originalRoot: string; worktreeRoot: string; repoId?: string }>;
}) {
  return {
    contextPackBinding: {
      contextPackPath: null,
      dataHostDir: null,
      dataContainerDir: null,
      repoBindings: (options.repoBindings ?? []).map((binding) => ({
        ...binding,
        worktreeBranch: 'task/t1',
        baseCommitSha: 'abc123',
      })),
      readonlyContextBindings: (options.readonlyContextBindings ?? []).map((binding) => ({
        ...binding,
        baseCommitSha: 'def456',
        repoId: binding.repoId ?? 'support',
        role: 'support' as const,
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCaptureChangedPathsSnapshot.mockImplementation(async (roots: string[]) => ({
    byRepoRoot: Object.fromEntries(roots.map((root) => [root, []])),
  }));
  mockedValidateDaltonBoundaryChanges.mockResolvedValue(undefined);
  mockedReadTaskJsonSafe.mockReturnValue(null);
});

describe('buildArtifactCleanupPrompt', () => {
  it('renders exact-path cleanup guardrails and supplied forbidden tokens', () => {
    const prompt = buildArtifactCleanupPrompt({
      artifactPrompt: '- /repo/AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md: fill Decision.',
      policyFailureDetails: 'parallel-ok decision missing',
      forbiddenPathTokens: ['$CUSTOM_HANDOFFS_DIR', '$CUSTOM_IMPL_STEPS_DIR', 'AgentWorkSpace/tasks/active'],
    });

    expect(prompt).toContain('Your previous run did not leave the workflow ready for the next role.');
    expect(prompt).toContain('Blocking workflow-policy details: parallel-ok decision missing');
    expect(prompt).toContain('Use only the exact absolute artifact paths listed below.');
    expect(prompt).toContain('- $CUSTOM_HANDOFFS_DIR');
    expect(prompt).toContain('- $CUSTOM_IMPL_STEPS_DIR');
    expect(prompt).toContain('- AgentWorkSpace/tasks/active');
    expect(prompt).toContain('Do not use shell commands to create workflow artifact directories');
    expect(prompt).toContain('If a write fails, report the exact listed path and the failure');
    expect(prompt).toContain('/repo/AgentWorkSpace/tasks/t1/handoffs/parallel-ok.md');
    expect(prompt).not.toContain('$COPILOT_HANDOFFS_DIR');
  });
});

describe('resolveDaltonBoundaryMonitorRoots', () => {
  it('returns task-sidecar-worktrees for task sidecars and legacy-focused-roots for absent or blank taskId', () => {
    mockedReadTaskJsonSafe.mockReturnValue(makeSidecar({
      repoBindings: [{ originalRoot: '/live/app', worktreeRoot: '/task/worktrees/app' }],
    }) as never);

    expect(resolveDaltonBoundaryMonitorRoots({
      taskId: 'task-test-001',
      repoRoot: '/repo',
      focused: makeFocused(),
    })).toEqual({
      roots: ['/task/worktrees/app'],
      source: 'task-sidecar-worktrees',
    });

    expect(resolveDaltonBoundaryMonitorRoots({
      repoRoot: '/repo',
      focused: makeFocused(),
    })).toEqual({
      roots: ['/repo', '/live/app', '/live/support'],
      source: 'legacy-focused-roots',
    });

    expect(resolveDaltonBoundaryMonitorRoots({
      taskId: '   ',
      repoRoot: '/repo',
      focused: makeFocused(),
    })).toEqual({
      roots: ['/repo', '/live/app', '/live/support'],
      source: 'legacy-focused-roots',
    });
  });
});

describe('prepareDaltonBoundary', () => {
  it('snapshots repoBinding and readonlyContextBinding worktreeRoot values in sidecar order', async () => {
    mockedReadTaskJsonSafe.mockReturnValue(makeSidecar({
      repoBindings: [{ originalRoot: '/live/app', worktreeRoot: '/task/worktrees/app' }],
      readonlyContextBindings: [{ originalRoot: '/live/support', worktreeRoot: '/task/worktrees/support' }],
    }) as never);

    await prepareDaltonBoundary(
      makeFocused({
        primaryRepoRoot: '/task/worktrees/app',
        visibleRepoRoots: ['/task/worktrees/app', '/task/worktrees/support'],
        declaredRepoRoots: ['/live/app', '/live/support', '/live/unbound'],
      }),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: 'task-test-001',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    );

    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenCalledWith([
      '/task/worktrees/app',
      '/task/worktrees/support',
    ]);
  });

  it('does not snapshot repoRoot, declared roots, binding originalRoot, or unbound live target roots for task launches', async () => {
    mockedReadTaskJsonSafe.mockReturnValue(makeSidecar({
      repoBindings: [{ originalRoot: '/live/tasksail', worktreeRoot: '/task/worktrees/tasksail' }],
      readonlyContextBindings: [{ originalRoot: '/live/support', worktreeRoot: '/task/worktrees/support' }],
    }) as never);

    await prepareDaltonBoundary(
      makeFocused({
        primaryRepoRoot: '/task/worktrees/tasksail',
        visibleRepoRoots: ['/task/worktrees/tasksail', '/task/worktrees/support'],
        declaredRepoRoots: ['/live/tasksail', '/live/support', '/live/unbound-target'],
      }),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: 'task-test-001',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    );

    const snapshotRoots = mockedCaptureChangedPathsSnapshot.mock.calls[0]?.[0];
    expect(snapshotRoots).toEqual(['/task/worktrees/tasksail', '/task/worktrees/support']);
    expect(snapshotRoots).not.toContain('/repo');
    expect(snapshotRoots).not.toContain('/live/tasksail');
    expect(snapshotRoots).not.toContain('/live/support');
    expect(snapshotRoots).not.toContain('/live/unbound-target');
  });

  it('fails closed before snapshotting when the task sidecar is missing', async () => {
    await expect(prepareDaltonBoundary(
      makeFocused(),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: 'task-test-001',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    )).rejects.toThrow(/Cannot prepare Dalton confinement.*task-test-001/);

    expect(mockedCaptureChangedPathsSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed before snapshotting when sidecar bindings are empty', async () => {
    mockedReadTaskJsonSafe.mockReturnValue(makeSidecar({ repoBindings: [], readonlyContextBindings: [] }) as never);

    await expect(prepareDaltonBoundary(
      makeFocused(),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: 'task-test-001',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    )).rejects.toThrow(/no task worktree roots/);

    expect(mockedCaptureChangedPathsSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed before snapshotting when every worktreeRoot is blank', async () => {
    mockedReadTaskJsonSafe.mockReturnValue(makeSidecar({
      repoBindings: [{ originalRoot: '/live/app', worktreeRoot: '   ' }],
      readonlyContextBindings: [{ originalRoot: '/live/support', worktreeRoot: '' }],
    }) as never);

    await expect(prepareDaltonBoundary(
      makeFocused(),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: 'task-test-001',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    )).rejects.toThrow(/no task worktree roots/);

    expect(mockedCaptureChangedPathsSnapshot).not.toHaveBeenCalled();
  });

  it('preserves legacy snapshot roots for non-task and blank-task launches', async () => {
    await prepareDaltonBoundary(
      makeFocused(),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    );
    await prepareDaltonBoundary(
      makeFocused(),
      {
        agentId: 'dalton',
        repoRoot: '/repo',
        taskId: '  ',
        usesFocusedRepoLaunch: true,
      },
      { model: 'gpt-4.1', autonomyProfile: 'repo-executor', allowedDirs: [], disallowTempDir: false },
    );

    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(1, [
      '/repo',
      '/live/app',
      '/live/support',
    ]);
    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenNthCalledWith(2, [
      '/repo',
      '/live/app',
      '/live/support',
    ]);
  });
});

describe('validateDaltonPostRunBoundary', () => {
  it('snapshots exactly pre-run snapshot roots without adding platformRepoRoot or declared roots', async () => {
    await validateDaltonPostRunBoundary({
      platformRepoRoot: '/repo',
      focused: makeFocused({
        declaredRepoRoots: ['/live/app', '/live/support'],
      }),
      preRunBoundarySnapshot: {
        byRepoRoot: {
          '/task/worktrees/app': [],
          '/task/worktrees/support': [],
        },
      },
    });

    expect(mockedCaptureChangedPathsSnapshot).toHaveBeenCalledWith([
      '/task/worktrees/app',
      '/task/worktrees/support',
    ]);
    expect(mockedValidateDaltonBoundaryChanges).toHaveBeenCalledWith(expect.objectContaining({
      platformRepoRoot: '/repo',
      before: {
        byRepoRoot: {
          '/task/worktrees/app': [],
          '/task/worktrees/support': [],
        },
      },
      after: {
        byRepoRoot: {
          '/task/worktrees/app': [],
          '/task/worktrees/support': [],
        },
      },
    }));
  });
});
