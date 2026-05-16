// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
const spawn = vi.fn();

vi.mock('./log/logger', () => ({
  createLogger: vi.fn(() => ({ warn })),
}));

vi.mock('node:child_process', () => ({
  spawn,
}));

describe('main.services diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('CONTAINER_RUNTIME', 'docker');
  });

  it('logs unexpected auto-start failures before preserving unhealthy state', async () => {
    spawn.mockImplementation(() => {
      throw new Error('spawn unavailable');
    });

    const { autoStartBackendServices, readBackendServiceStatus } = await import('./main.services');

    await autoStartBackendServices('/tmp/repo');

    expect(warn).toHaveBeenCalledWith('services.auto-start.failed', {
      reason: 'spawn unavailable',
    });
    expect(readBackendServiceStatus()).toEqual(expect.objectContaining({
      status: 'unhealthy',
      error: 'Unexpected error during auto-start.',
    }));
  });
});
