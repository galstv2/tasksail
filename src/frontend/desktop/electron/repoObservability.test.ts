// @vitest-environment node

import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

import { probePidLiveness, readObservabilitySnapshot } from './repoObservability';

const execSyncMock = vi.mocked(execSync);

describe('probePidLiveness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execSyncMock.mockReset();
  });

  it('uses best-effort PID liveness on Windows without shelling out to ps', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(probePidLiveness(48217, '2026-03-07T21:07:29Z', 'win32')).toBe('alive');
    expect(killSpy).toHaveBeenCalledWith(48217, 0);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('keeps the POSIX PID reuse guard on Unix-like platforms', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    execSyncMock.mockReturnValue('Fri Mar  7 21:10:40 2026');

    expect(probePidLiveness(48217, 'Fri Mar  7 21:07:29 2026', 'darwin')).toBe('not-found');
    expect(execSyncMock).toHaveBeenCalledWith(
      'ps -p 48217 -o lstart=',
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 2000,
        env: expect.objectContaining({ LC_TIME: 'C' }),
      }),
    );
  });
});

describe('role session receipt parsing', () => {
  it('uses launch_id for runtime session identity and launch_phase for labels', async () => {
    const receipts: Record<string, string> = {
      'dalton-initial.json': JSON.stringify({
        agent_id: 'dalton',
        launch_id: 'initial-launch',
        role_name: 'Software Engineer',
        session_kind: 'task-role',
        launch: {
          status: 'started',
          started_at: '2026-05-04T20:16:17Z',
          pid: null,
        },
        latest_output_lines: ['Started Dalton runtime.'],
      }),
      'dalton-retry.json': JSON.stringify({
        agent_id: 'dalton',
        launch_id: 'retry-launch',
        launch_phase: 'Confinement retry',
        retry_of_launch_id: 'initial-launch',
        role_name: 'Software Engineer',
        session_kind: 'task-role',
        launch: {
          status: 'started',
          started_at: '2026-05-04T20:16:17Z',
          pid: null,
        },
        latest_output_lines: ['Started Dalton Confinement retry runtime.'],
      }),
    };
    const fsAdapter = {
      access: vi.fn(async (targetPath: string) => {
        if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
          return;
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (targetPath: string) => {
        if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
          return Object.keys(receipts);
        }
        return [];
      }),
      readFile: vi.fn(async (targetPath: string) => {
        const filename = targetPath.split(/[\\/]/).at(-1) ?? '';
        return receipts[filename] ?? '';
      }),
    };

    const snapshot = await readObservabilitySnapshot(fsAdapter, ['TASK-A']);
    const sessions = snapshot.agentTerminalSessions ?? [];

    expect(sessions.map((session) => session.sessionId).sort()).toEqual([
      'role:dalton:initial-launch',
      'role:dalton:retry-launch',
    ]);
    expect(sessions.find((session) =>
      session.sessionId === 'role:dalton:retry-launch',
    )).toEqual(expect.objectContaining({
      agentLabel: 'Dalton (Software Engineer) — Confinement retry',
      latestOutputLines: ['Started Dalton Confinement retry runtime.'],
    }));
  });
});
