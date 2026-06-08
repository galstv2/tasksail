// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockClient } from '../../../test';

import { useReinforcementTasks } from './useReinforcementTasks';

describe('useReinforcementTasks', () => {
  it('returns empty tasks when no active context pack', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useReinforcementTasks(null, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.tasks).toEqual([]);
  });

  it('loads tasks on mount', async () => {
    const client = createMockClient({
      listReinforcementTasks: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'reinforcement.listTasks',
          tasks: [
            {
              taskId: 'T-1',
              title: 'Task',
              difficulty: 'medium',
              effectiveReward: 1.0,
              settlementStatus: 'unrewarded',
              qualityOutcome: 'success',
              year: '2026',
            },
          ],
          availableYears: ['2026'],
        },
      }),
    });
    const { result } = renderHook(() => useReinforcementTasks('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].taskId).toBe('T-1');
    expect(result.current.availableYears).toEqual(['2026']);
  });

  it('sets error on IPC failure', async () => {
    const client = createMockClient({
      listReinforcementTasks: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Network error',
      }),
    });
    const { result } = renderHook(() => useReinforcementTasks('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
  });

  it('passes year to client when selectedYear is set', async () => {
    const listFn = vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.listTasks',
        tasks: [],
        availableYears: ['2025', '2026'],
      },
    });
    const client = createMockClient({ listReinforcementTasks: listFn });
    const { result } = renderHook(() => useReinforcementTasks('/packs/test', client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onSelectYear('2025');
    });

    await waitFor(() => expect(listFn).toHaveBeenCalledWith('2025'));
  });

  it('resets and reloads when activeContextPackDir changes', async () => {
    const listFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.listTasks',
          tasks: [{ taskId: 'T-A', title: 'Task A', difficulty: 'medium', effectiveReward: 1, settlementStatus: 'unrewarded', qualityOutcome: 'success', year: '2026' }],
          availableYears: ['2026'],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.listTasks',
          tasks: [{ taskId: 'T-B', title: 'Task B', difficulty: 'medium', effectiveReward: 1, settlementStatus: 'unrewarded', qualityOutcome: 'success', year: '2026' }],
          availableYears: ['2026'],
        },
      });
    const client = createMockClient({ listReinforcementTasks: listFn });
    let packDir = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useReinforcementTasks(packDir, client));

    await waitFor(() => expect(result.current.tasks[0]?.taskId).toBe('T-A'));

    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.tasks[0]?.taskId).toBe('T-B'));
    // Old tasks cleared on switch
    expect(result.current.tasks.some((t) => t.taskId === 'T-A')).toBe(false);
  });

  it('ignores stale responses from old pack after pack change', async () => {
    let resolveOld!: (v: unknown) => void;
    const oldPackPromise = new Promise((resolve) => { resolveOld = resolve; });
    const listFn = vi.fn()
      .mockReturnValueOnce(oldPackPromise)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          action: 'reinforcement.listTasks',
          tasks: [{ taskId: 'T-B', title: 'Task B', difficulty: 'medium', effectiveReward: 1, settlementStatus: 'unrewarded', qualityOutcome: 'success', year: '2026' }],
          availableYears: ['2026'],
        },
      });
    const client = createMockClient({ listReinforcementTasks: listFn });
    let packDir: string | null = '/packs/pack-a';
    const { result, rerender } = renderHook(() => useReinforcementTasks(packDir, client));

    // Switch to pack B before old pack resolves
    packDir = '/packs/pack-b';
    rerender();

    await waitFor(() => expect(result.current.tasks[0]?.taskId).toBe('T-B'));

    // Now resolve the old pack A response — it must be ignored
    resolveOld({
      ok: true,
      response: {
        action: 'reinforcement.listTasks',
        tasks: [{ taskId: 'T-A', title: 'Task A', difficulty: 'medium', effectiveReward: 1, settlementStatus: 'unrewarded', qualityOutcome: 'success', year: '2026' }],
        availableYears: ['2026'],
      },
    });

    // T-A must not appear in current tasks
    await waitFor(() => expect(result.current.tasks.some((t) => t.taskId === 'T-A')).toBe(false));
    expect(result.current.tasks[0]?.taskId).toBe('T-B');
  });
});
