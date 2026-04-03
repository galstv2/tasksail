// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockClient } from '../../test';

import { useReinforcementTasks } from './useReinforcementTasks';

describe('useReinforcementTasks', () => {
  it('returns empty tasks when no active context pack', async () => {
    const client = createMockClient();
    const { result } = renderHook(() => useReinforcementTasks(false, client));

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
    const { result } = renderHook(() => useReinforcementTasks(true, client));

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
    const { result } = renderHook(() => useReinforcementTasks(true, client));

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
    const { result } = renderHook(() => useReinforcementTasks(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onSelectYear('2025');
    });

    await waitFor(() => expect(listFn).toHaveBeenCalledWith('2025'));
  });
});
