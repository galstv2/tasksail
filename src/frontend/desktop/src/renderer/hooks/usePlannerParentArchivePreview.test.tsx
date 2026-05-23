import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ArchivedTaskEntry } from '../../shared/desktopContract';
import { usePlannerParentArchivePreview } from './usePlannerParentArchivePreview';

function parentTask(): ArchivedTaskEntry {
  return {
    taskId: 'parent-1',
    title: 'Parent',
    summary: '',
    rootTaskId: 'parent-1',
    qmdRecordId: '',
    followupReason: '',
    year: '2026',
    archivePath: '/tmp/archive.md',
    archivedAt: '2026-05-17T08:42:11Z',
    contextPackName: 'test',
    plannerFocusSnapshot: {
      version: 1,
      contextPackDir: '/packs/test',
      contextPackId: 'test',
      title: 'Parent',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repo',
      primaryFocusRelativePath: null,
      primaryFocusTargetKind: null,
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      deepFocusEnabled: false,
      contextPackBinding: {
        contextPackDir: '/packs/test',
        contextPackId: 'test',
        scopeMode: 'all',
        selectedRepoIds: [],
        selectedFocusIds: [],
        deepFocusEnabled: false,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    },
  };
}

describe('usePlannerParentArchivePreview', () => {
  it('loads archive markdown and supports retry after failure', async () => {
    const readParentArchiveMarkdown = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Failed once.' })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.readParentArchiveMarkdown',
          mode: 'loaded',
          accepted: true,
          message: 'Loaded.',
          taskId: 'parent-1',
          title: 'Parent',
          archivePath: '/tmp/archive.md',
          archivedAt: null,
          content: '# Parent',
          sizeBytes: 8,
        },
      });
    const { result } = renderHook(() => usePlannerParentArchivePreview({ readParentArchiveMarkdown } as never));

    await act(async () => {
      await result.current.openForTask(parentTask());
    });
    expect(result.current.open).toBe(true);
    expect(result.current.error).toBe('Failed once.');

    await act(async () => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.archive?.content).toBe('# Parent'));
    expect(readParentArchiveMarkdown).toHaveBeenLastCalledWith({
      parentTaskId: 'parent-1',
      contextPackDir: '/packs/test',
      contextPackId: 'test',
    });
  });
});
