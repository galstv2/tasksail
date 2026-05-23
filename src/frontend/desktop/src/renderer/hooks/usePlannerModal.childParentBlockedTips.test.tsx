// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createArchivedTask, createClient, renderPlannerModalHook } from './usePlannerModal.testSetup';

describe('usePlannerModal child parent blocked tips', () => {
  it('stores response-level blocked tips separately from selectable archived tasks', async () => {
    const selectable = createArchivedTask({ taskId: 'parent', title: 'Parent' });
    const listArchivedTasks = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'planner.listArchivedTasks',
        mode: 'found',
        message: 'Found.',
        tasks: [selectable],
        childParentBlockedTips: [{
          rootTaskId: 'root',
          blockedParentTaskId: 'parent',
          currentTipTaskId: 'reserved-child',
          chainState: 'planned',
          boardState: 'open',
          title: 'Reserved child',
          fileName: 'reserved-child.md',
          message: 'This chain already has a child task in progress or needing attention.',
        }],
      },
    });
    const { result } = renderPlannerModalHook(createClient({ listArchivedTasks }));

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });

    await waitFor(() => expect(result.current.plannerModalProps.archivedTasks).toEqual([selectable]));
    expect(result.current.plannerModalProps.childParentBlockedTips).toEqual([
      expect.objectContaining({ currentTipTaskId: 'reserved-child', boardState: 'open' }),
    ]);
  });

  it('resets blocked tips when child task mode is disabled or archive loading fails', async () => {
    const listArchivedTasks = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'planner.listArchivedTasks',
          mode: 'empty',
          message: 'Empty.',
          tasks: [],
          childParentBlockedTips: [{
            rootTaskId: 'root',
            blockedParentTaskId: 'parent',
            currentTipTaskId: 'reserved-child',
            chainState: 'pending',
            boardState: 'pending',
            title: 'Reserved child',
            fileName: 'reserved-child.md',
            message: 'This chain already has a child task in progress or needing attention.',
          }],
        },
      })
      .mockRejectedValueOnce(new Error('load failed'));
    const { result } = renderPlannerModalHook(createClient({ listArchivedTasks }));

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childParentBlockedTips).toHaveLength(1));

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    expect(result.current.plannerModalProps.childParentBlockedTips).toEqual([]);

    act(() => {
      result.current.plannerModalProps.onToggleChildTaskMode?.();
    });
    await waitFor(() => expect(result.current.plannerModalProps.childParentBlockedTips).toEqual([]));
  });
});
