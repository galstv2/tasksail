// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SHELL_STREAM_CHANNEL } from '../src/shared/desktopContract';

const send = vi.fn();
const getAllWindows = vi.fn();
const randomUUID = vi.fn();
const readFileSync = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows,
  },
}));

vi.mock('node:crypto', () => ({
  randomUUID,
}));

vi.mock('node:fs', () => ({
  readFileSync,
}));

vi.mock('./paths', () => ({
  REPO_ROOT: '/repo',
}));

describe('main.stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { send },
      },
    ]);
    randomUUID
      .mockReturnValueOnce('12345678-1234-4234-9234-123456789abc')
      .mockReturnValueOnce('abcdef12-abcd-4abc-9abc-abcdef123456');
    readFileSync.mockImplementation(() => {
      throw Object.assign(new Error('missing registry'), { code: 'ENOENT' });
    });
  });

  it('prefixes task-scoped terminal messages with a stable registry GUID per task', async () => {
    const { emitStreamEvent } = await import('./main.stream');
    readFileSync.mockReturnValue(JSON.stringify({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
            },
          ],
          pending: [],
          active: [
            {
              taskId: 'TASK-B',
              taskGuid: 'cafef00d-abcd-4abc-9abc-abcdef123456',
            },
          ],
          failed: [],
          completed: [],
        },
      },
    }));

    emitStreamEvent({
      message: 'Completed.',
      source: 'runtime.agentSession',
      role: 'workflow',
      taskId: 'TASK-A',
    });
    emitStreamEvent({
      message: 'Test evidence captured.',
      source: 'runtime.pipeline',
      role: 'system',
      taskId: 'TASK-A',
    });
    emitStreamEvent({
      message: 'Launch started.',
      source: 'runtime.agentSession',
      role: 'workflow',
      taskId: 'TASK-B',
    });

    expect(send).toHaveBeenNthCalledWith(
      1,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        message: 'Task [feedbeef] Completed.',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        message: 'Task [feedbeef] Test evidence captured.',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      3,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-B',
        message: 'Task [cafef00d] Launch started.',
      }),
    );
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('includes the actor after the task GUID for task-scoped actor messages', async () => {
    const { emitStreamEvent } = await import('./main.stream');
    readFileSync.mockReturnValue(JSON.stringify({
      schema_version: 2,
      tasks: {
        _unbound: {
          open: [
            {
              taskId: 'TASK-A',
              taskGuid: 'feedbeef-1234-4234-9234-123456789abc',
            },
          ],
          pending: [],
          active: [],
          failed: [],
          completed: [],
        },
      },
    }));

    emitStreamEvent({
      message: 'Is running.',
      source: 'runtime.agentSession',
      role: 'workflow',
      taskId: 'TASK-A',
      actorName: 'Alice (Product Manager)',
    });

    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-A',
        actorName: 'Alice (Product Manager)',
        message: 'Task [feedbeef] Alice (Product Manager): Is running.',
      }),
    );
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('leaves non-task and already-prefixed messages unchanged', async () => {
    const { emitStreamEvent } = await import('./main.stream');

    emitStreamEvent({
      message: 'Backend services started.',
      source: 'services.startBackend',
      role: 'system',
    });
    emitStreamEvent({
      message: 'Task [deadbeef] Already tagged.',
      source: 'runtime.pipeline',
      role: 'system',
      taskId: 'TASK-C',
    });

    expect(send).toHaveBeenNthCalledWith(
      1,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'N/A',
        message: 'Backend services started.',
      }),
    );
    expect(send).toHaveBeenNthCalledWith(
      2,
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-C',
        message: 'Task [deadbeef] Already tagged.',
      }),
    );
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('falls back to a generated GUID when task registry lookup misses', async () => {
    const { emitStreamEvent } = await import('./main.stream');

    emitStreamEvent({
      message: 'Completed.',
      source: 'runtime.agentSession',
      role: 'workflow',
      taskId: 'TASK-MISSING',
    });

    expect(send).toHaveBeenCalledWith(
      DESKTOP_SHELL_STREAM_CHANNEL,
      expect.objectContaining({
        taskId: 'TASK-MISSING',
        message: 'Task [12345678] Completed.',
      }),
    );
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
