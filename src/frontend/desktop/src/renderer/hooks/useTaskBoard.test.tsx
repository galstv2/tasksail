// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider } from '../contexts/ToastContext';
import { createMockClient } from '../../test';
import { useTaskBoard } from './useTaskBoard';

beforeEach(() => {
  vi.mocked(window.desktopShell.log.emit).mockClear();
});

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('useTaskBoard', () => {
  it('logs and returns false when delete task IPC rejects', async () => {
    const client = createMockClient({
      deleteTask: vi.fn().mockRejectedValue(new Error('Delete IPC failed.')),
    });
    const { result } = renderHook(() => useTaskBoard(client), { wrapper });

    await expect(result.current.deleteTask('task.md', 'open')).resolves.toBe(false);

    await waitFor(() => {
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'task-board.delete-task.failed',
        level: 'warn',
        extra: {
          fileName: 'task.md',
          column: 'open',
          reason: 'Delete IPC failed.',
        },
      }));
    });
  });

  it('logs task board refresh IPC rejections', async () => {
    const client = createMockClient({
      readTaskBoard: vi.fn().mockRejectedValue(new Error('Board read failed.')),
    });

    renderHook(() => useTaskBoard(client), { wrapper });

    await waitFor(() => {
      expect(window.desktopShell.log.emit).toHaveBeenCalledWith(expect.objectContaining({
        msg: 'task-board.refresh.failed',
        level: 'warn',
        extra: { reason: 'Board read failed.' },
      }));
    });
  });
});
