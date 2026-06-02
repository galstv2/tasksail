import { describe, it, expect, vi, afterEach } from 'vitest';

const spawnDirectMcpMock = vi.hoisted(() => vi.fn());
const stopDirectMcpMock = vi.hoisted(() => vi.fn());
const seedIndexMock = vi.hoisted(() => vi.fn());
const getPlatformConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../directRuntimeProcess.js', () => ({
  spawnDirectMcp: spawnDirectMcpMock,
  stopDirectMcp: stopDirectMcpMock,
}));

vi.mock('../seedIndex.js', () => ({
  seedIndex: seedIndexMock,
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: getPlatformConfigMock,
}));

describe('DirectRuntime', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    spawnDirectMcpMock.mockReset();
    stopDirectMcpMock.mockReset();
    seedIndexMock.mockReset();
    getPlatformConfigMock.mockReset();
  });

  it('declares direct backend and no compose requirement', async () => {
    const { DirectRuntime } = await import('../directRuntime.js');
    const runtime = new DirectRuntime();

    expect(runtime.backend).toBe('direct');
    expect(runtime.requiresComposeFile).toBe(false);
    expect(runtime.engineHost).toBe('native');
    expect(runtime.wslDistro).toBeNull();
  });

  it('constructs on Windows (direct runtime is supported there now)', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const { DirectRuntime } = await import('../directRuntime.js');

    const runtime = new DirectRuntime();
    expect(runtime.backend).toBe('direct');
    expect(runtime.requiresComposeFile).toBe(false);
  });

  it('composeUp requires TASKSAIL_REPO_ROOT', async () => {
    const { DirectRuntime } = await import('../directRuntime.js');
    const runtime = new DirectRuntime();

    await expect(runtime.composeUp({ env: {} })).rejects.toThrow('TASKSAIL_REPO_ROOT');
  });

  it('composeUp spawns the process with configured port', async () => {
    getPlatformConfigMock.mockResolvedValue({ mcp_port: 8899 });
    const { DirectRuntime } = await import('../directRuntime.js');
    const runtime = new DirectRuntime();

    await runtime.composeUp({ env: { TASKSAIL_REPO_ROOT: '/repo' } });

    expect(spawnDirectMcpMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      port: 8899,
      env: { TASKSAIL_REPO_ROOT: '/repo' },
    });
  });

  it('seedIndex delegates to the shared helper', async () => {
    const { DirectRuntime } = await import('../directRuntime.js');
    const runtime = new DirectRuntime();
    const options = { repoRoot: '/repo', contextPackDir: '/repo/pack' };

    await runtime.seedIndex(options);

    expect(seedIndexMock).toHaveBeenCalledWith(options);
  });
});
