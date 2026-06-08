// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('startup recovery auto-start', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function installAutoStartMocks(options?: {
    refreshScope?: () => Promise<{ changed: boolean }>;
    refreshMetadata?: () => Promise<void>;
  }): {
    refreshCurrentActiveContextPackTaskScope: ReturnType<typeof vi.fn>;
    refreshRuntimeStreamState: ReturnType<typeof vi.fn>;
    refreshStreamTaskMetadataForScope: ReturnType<typeof vi.fn>;
    runPipelineSequence: ReturnType<typeof vi.fn>;
    warnSpy: ReturnType<typeof vi.fn>;
  } {
    const warnSpy = vi.fn();
    const refreshCurrentActiveContextPackTaskScope = vi.fn(
      options?.refreshScope ??
        (async () => ({
          previous: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
          next: { contextPackId: 'pack-a', contextPackDir: '/packs/pack-a', contextPackName: 'pack-a' },
          changed: false,
        })),
    );
    const refreshRuntimeStreamState = vi.fn(async () => undefined);
    const refreshStreamTaskMetadataForScope = vi.fn(
      options?.refreshMetadata ?? (async () => undefined),
    );
    const runPipelineSequence = vi.fn(async () => ({
      workflowPath: 'standard',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationSeconds: 0,
      agentsRun: [],
      contextPackDir: null,
      status: 'completed',
    }));

    vi.doMock('../log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
      installProcessHandlers: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../contextPack/taskVisibility', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../contextPack/taskVisibility')>()),
      getCurrentActiveContextPackTaskScope: vi.fn(() => ({
        contextPackId: 'pack-a',
        contextPackDir: '/packs/pack-a',
        contextPackName: 'pack-a',
      })),
      refreshCurrentActiveContextPackTaskScope,
    }));
    vi.doMock('../runtime/runtimeStream', () => ({
      refreshRuntimeStreamState,
      resetRuntimeStreamState: vi.fn(),
      startRuntimeStreamWatcher: vi.fn(() => vi.fn()),
    }));
    vi.doMock('../runtime/stream', () => ({
      emitStreamEvent: vi.fn(),
      refreshStreamTaskMetadataForScope,
      resetStreamState: vi.fn(),
    }));
    vi.doMock('../../../../backend/platform/agent-runner/pipeline/sequencer.js', () => ({
      runPipelineSequence,
    }));
    vi.doMock('../../../../backend/platform/queue', () => ({
      getQueueStatus: vi.fn(async () => ({
        dropboxItems: [],
        pendingItems: ['20260328-task.md'],
        activeItem: '20260328-task.md',
        activeTasks: [{
          taskId: '20260328-task',
          state: 'active' as const,
          handoffsDir: '/repo/AgentWorkSpace/tasks/20260328-task/handoffs',
        }],
        workspaceReady: false,
        activeTaskWithBlankWorkspace: false,
        partialPublish: false,
        errorItemsCount: 0,
      })),
    }));
    vi.doMock('../../../../backend/platform/agent-runner/pipelineSupervisor.js', () => ({
      listActivePipelines: vi.fn(() => []),
      stopPipeline: vi.fn(async () => undefined),
    }));

    return {
      refreshCurrentActiveContextPackTaskScope,
      refreshRuntimeStreamState,
      refreshStreamTaskMetadataForScope,
      runPipelineSequence,
      warnSpy,
    };
  }

  it('auto-start refreshes terminal metadata before launching the pipeline', async () => {
    const {
      refreshCurrentActiveContextPackTaskScope,
      refreshRuntimeStreamState,
      refreshStreamTaskMetadataForScope,
      runPipelineSequence,
    } = installAutoStartMocks();

    const { schedulePipelineAutoStart } = await import('./startupRecovery');

    schedulePipelineAutoStart();

    await vi.waitFor(() => {
      expect(runPipelineSequence).toHaveBeenCalledWith({
        repoRoot: expect.any(String),
        startAt: 'alice',
        taskId: '20260328-task',
      });
    });
    expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledOnce();
    expect(refreshCurrentActiveContextPackTaskScope.mock.invocationCallOrder[0])
      .toBeLessThan(runPipelineSequence.mock.invocationCallOrder[0]);
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledOnce();
    expect(refreshStreamTaskMetadataForScope.mock.invocationCallOrder[0])
      .toBeLessThan(runPipelineSequence.mock.invocationCallOrder[0]);
    expect(refreshRuntimeStreamState).toHaveBeenCalledOnce();
    expect(refreshRuntimeStreamState.mock.invocationCallOrder[0])
      .toBeLessThan(runPipelineSequence.mock.invocationCallOrder[0]);
  });

  it('auto-start logs refresh failures and still launches after fallback runtime refresh', async () => {
    const {
      refreshCurrentActiveContextPackTaskScope,
      refreshRuntimeStreamState,
      refreshStreamTaskMetadataForScope,
      runPipelineSequence,
      warnSpy,
    } = installAutoStartMocks({
      refreshScope: async () => {
        throw new Error('scope refresh denied');
      },
      refreshMetadata: async () => {
        throw new Error('metadata refresh denied');
      },
    });

    const { schedulePipelineAutoStart } = await import('./startupRecovery');

    schedulePipelineAutoStart();

    await vi.waitFor(() => {
      expect(runPipelineSequence).toHaveBeenCalledWith({
        repoRoot: expect.any(String),
        startAt: 'alice',
        taskId: '20260328-task',
      });
    });
    expect(refreshCurrentActiveContextPackTaskScope).toHaveBeenCalledOnce();
    expect(refreshStreamTaskMetadataForScope).toHaveBeenCalledOnce();
    expect(refreshRuntimeStreamState).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith('terminal.pre-pipeline-refresh.failed', {
      reason: 'scope refresh denied',
    });
    expect(warnSpy).toHaveBeenCalledWith('terminal.task-metadata-refresh.failed', {
      reason: 'metadata refresh denied',
    });
    expect(refreshRuntimeStreamState.mock.invocationCallOrder[0])
      .toBeLessThan(runPipelineSequence.mock.invocationCallOrder[0]);
  });
});
