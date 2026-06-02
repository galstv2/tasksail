// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const relaunch = vi.fn();
const quit = vi.fn();

vi.mock('electron', () => ({ app: { relaunch, quit } }));

describe('restartTaskSailApp', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it('relaunches the app in production (no dev server)', async () => {
    delete process.env.VITE_DEV_SERVER_URL;
    const { restartTaskSailApp } = await import('./appRestart');

    restartTaskSailApp();

    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('asks the dev launcher for a clean managed restart in a dev session', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    const originalSend = process.send;
    const send = vi.fn(() => true);
    process.send = send as unknown as typeof process.send;
    try {
      const { restartTaskSailApp } = await import('./appRestart');

      restartTaskSailApp();

      expect(send).toHaveBeenCalledWith('tasksail:dev-restart-request');
      expect(relaunch).not.toHaveBeenCalled();
      expect(quit).not.toHaveBeenCalled();
    } finally {
      process.send = originalSend;
    }
  });
});
