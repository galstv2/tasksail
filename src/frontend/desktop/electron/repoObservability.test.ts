// @vitest-environment node

import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';

import { probePidLiveness } from './repoObservability';

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
