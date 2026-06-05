import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(),
}));

vi.mock('../healthcheck.js', () => ({
  checkServiceHealth: vi.fn(),
}));

vi.mock('../runtime.js', () => ({
  createRuntimeFromConfig: vi.fn(),
}));

vi.mock('../directRuntimeProcess.js', () => ({
  isDirectMcpHealthy: vi.fn(),
}));

// Hoist mocks so they can be referenced in the factories below.
const { toEngineHostPathMock, acquireDirLockMock } = vi.hoisted(() => ({
  toEngineHostPathMock: vi.fn((p: string) => p),
  acquireDirLockMock: vi.fn<Parameters<typeof import('../../queue/dirLock.js').acquireDirLock>, ReturnType<typeof import('../../queue/dirLock.js').acquireDirLock>>(),
}));

vi.mock('../../queue/dirLock.js', () => ({
  acquireDirLock: acquireDirLockMock,
}));

vi.mock('../../core/platform.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/platform.js')>();
  return {
    ...actual,
    toEngineHostPath: toEngineHostPathMock,
  };
});

const { mkdir, readFile, rename, rm, stat, writeFile } = await import('node:fs/promises');
const { getPlatformConfig } = await import('../../platform-config/get.js');
const { checkServiceHealth } = await import('../healthcheck.js');
const { createRuntimeFromConfig } = await import('../runtime.js');
const { isDirectMcpHealthy } = await import('../directRuntimeProcess.js');
const {
  ContextPackNotMountedError,
  createSharedMcpBootstrapEnv,
  ensureSharedMcpRunning,
  generateSharedMcpComposeOverride,
  getSharedMcpHealthUrl,
  getSharedMcpPort,
  getSharedMcpUrl,
  resolveContextPackContainerPath,
  runtimeRequiresContainerPaths,
  sweepLegacyPortAllocationsOnce,
} = await import('../sharedMcp.js');

const mockGetPlatformConfig = vi.mocked(getPlatformConfig);
const mockCheckServiceHealth = vi.mocked(checkServiceHealth);
const mockCreateRuntimeFromConfig = vi.mocked(createRuntimeFromConfig);
const mockIsDirectMcpHealthy = vi.mocked(isDirectMcpHealthy);

describe('shared MCP helpers', () => {
  beforeEach(() => {
    mockGetPlatformConfig.mockReset();
    mockCheckServiceHealth.mockReset();
    mockCreateRuntimeFromConfig.mockReset();
    mockIsDirectMcpHealthy.mockReset();
    toEngineHostPathMock.mockReset();
    toEngineHostPathMock.mockImplementation((p: string) => p);
    acquireDirLockMock.mockReset();
    // Default: immediately return a no-op release function (lock always acquired).
    acquireDirLockMock.mockResolvedValue(async () => { /* no-op release */ });
    vi.mocked(mkdir).mockClear();
    vi.mocked(readFile).mockReset();
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    vi.mocked(rename).mockClear();
    vi.mocked(rm).mockClear();
    vi.mocked(stat).mockReset();
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    vi.mocked(writeFile).mockClear();
  });

  it('reads the shared MCP port from platform config', async () => {
    mockGetPlatformConfig.mockResolvedValue({ mcp_port: 8817 } as never);

    await expect(getSharedMcpPort('/repo')).resolves.toBe(8817);

    expect(mockGetPlatformConfig).toHaveBeenCalledWith('/repo');
    expect(mockGetPlatformConfig).toHaveBeenCalledTimes(1);
  });

  it('builds shared SSE and health URLs using 127.0.0.1', async () => {
    mockGetPlatformConfig.mockResolvedValue({ mcp_port: 8817 } as never);

    await expect(getSharedMcpUrl('/repo')).resolves.toBe('http://127.0.0.1:8817/sse');
    await expect(getSharedMcpHealthUrl('/repo')).resolves.toBe('http://127.0.0.1:8817/health');
  });

  it('maps context packs under the repo root to /workspace', () => {
    const repoRoot = path.join(path.sep, 'repo');
    const contextPackDir = path.join(repoRoot, 'contextpacks', 'active');

    expect(resolveContextPackContainerPath(repoRoot, contextPackDir, [])).toBe(
      '/workspace/contextpacks/active',
    );
  });

  it('maps context packs under configured external roots by root index', () => {
    const repoRoot = path.join(path.sep, 'repo');
    const firstRoot = path.join(path.sep, 'external-a');
    const secondRoot = path.join(path.sep, 'external-b');
    const contextPackDir = path.join(secondRoot, 'packs', 'active');

    expect(
      resolveContextPackContainerPath(repoRoot, contextPackDir, [firstRoot, secondRoot]),
    ).toBe('/context-pack-roots/1/packs/active');
  });

  it('throws context-pack-not-mounted for paths outside allowed roots', () => {
    const repoRoot = path.join(path.sep, 'repo');
    const contextPackDir = path.join(path.sep, 'elsewhere', 'active');

    expect(() => resolveContextPackContainerPath(repoRoot, contextPackDir, [])).toThrow(
      ContextPackNotMountedError,
    );
    expect(() => resolveContextPackContainerPath(repoRoot, contextPackDir, [])).toThrow(
      'context-pack-not-mounted',
    );
  });

  it('rejects relative external roots', () => {
    const repoRoot = path.join(path.sep, 'repo');
    const contextPackDir = path.join(path.sep, 'relative-root', 'pack');

    expect(() => resolveContextPackContainerPath(repoRoot, contextPackDir, ['relative-root']))
      .toThrow('absolute host paths');
  });

  it('scrubs inherited per-task env keys while setting the shared MCP port', () => {
    const env = createSharedMcpBootstrapEnv(8817, {
      PATH: '/bin',
      COMPOSE_PROJECT_NAME: 'tasksail-task-a',
      REPO_CONTEXT_MCP_CONTAINER_NAME: 'repo-context-mcp-task-a',
      REPO_CONTEXT_MCP_PORT: '8820',
      REPO_CONTEXT_MCP_CONTAINER_PORT: '9999',
      TASKSAIL_TASK_ID: 'task-a',
      ACTIVE_CONTEXT_PACK_DIR: '/mnt/context-pack',
      ACTIVE_CONTEXT_PACK_HOST_DIR: '/host/context-pack',
    });

    expect(env).toMatchObject({
      PATH: '/bin',
      REPO_CONTEXT_MCP_PORT: '8817',
      REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
    });
    expect(env).not.toHaveProperty('COMPOSE_PROJECT_NAME');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_CONTAINER_NAME');
    expect(env).not.toHaveProperty('TASKSAIL_TASK_ID');
    expect(env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_DIR');
    expect(env).not.toHaveProperty('ACTIVE_CONTEXT_PACK_HOST_DIR');
  });

  it('writes a deterministic compose override for external mount roots', async () => {
    const repoRoot = path.join(path.sep, 'repo');
    const firstRoot = path.join(path.sep, 'external-a');
    const secondRoot = path.join(path.sep, 'external-b');

    await expect(
      generateSharedMcpComposeOverride(repoRoot, [firstRoot, secondRoot]),
    ).resolves.toBe(path.join(repoRoot, '.platform-state/runtime/shared-mcp-compose.override.yml'));

    expect(stat).toHaveBeenCalledWith(firstRoot);
    expect(stat).toHaveBeenCalledWith(secondRoot);
    expect(mkdir).toHaveBeenCalledWith(
      path.join(repoRoot, '.platform-state/runtime'),
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/shared-mcp-compose\.override\.yml\.tmp-/),
      [
        '# Generated by TaskSail. Do not edit.',
        'services:',
        '  repo-context-mcp:',
        '    volumes:',
        '      - type: bind',
        `        source: ${JSON.stringify(firstRoot)}`,
        '        target: /context-pack-roots/0',
        '        read_only: true',
        '      - type: bind',
        `        source: ${JSON.stringify(secondRoot)}`,
        '        target: /context-pack-roots/1',
        '        read_only: true',
        '',
      ].join('\n'),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
    expect(rename).toHaveBeenCalledWith(
      expect.stringMatching(/shared-mcp-compose\.override\.yml\.tmp-/),
      path.join(repoRoot, '.platform-state/runtime/shared-mcp-compose.override.yml'),
    );
  });

  it('serializes concurrent shared MCP bootstraps per repo root', async () => {
    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      container_runtime: 'docker',
      repo_context_mcp_external_mount_roots: [],
    } as never);
    let healthChecks = 0;
    mockCheckServiceHealth.mockImplementation(async () => {
      healthChecks += 1;
      // 10 concurrent fast-path calls (unhealthy) + 1 post-lock re-check (unhealthy) = 11 checks
      // before bootstrap; then the post-bootstrap check (12th) is healthy.
      return { service: 'repo-context-mcp', healthy: healthChecks >= 12, attempts: 1 };
    });
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    await expect(Promise.all(
      Array.from({ length: 10 }, () => ensureSharedMcpRunning('/repo-concurrent')),
    )).resolves.toHaveLength(10);

    expect(runtime.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('translates bind sources via toEngineHostPath for WSL engine mode', async () => {
    // Use POSIX absolute paths: the path must pass path.isAbsolute() on the test host.
    // The WSL translation is mocked — we verify the wiring, not the shell-out.
    const repoRoot = path.join(path.sep, 'repo');
    const externalRoot = path.join(path.sep, 'host', 'ops', 'packs');
    const translatedRoot = '/mnt/c/Users/ops/packs';
    toEngineHostPathMock.mockImplementation((p: string) => {
      if (p === path.resolve(externalRoot)) return translatedRoot;
      return p;
    });

    await generateSharedMcpComposeOverride(
      repoRoot,
      [externalRoot],
      { engineHost: 'wsl', wslDistro: 'Ubuntu' },
    );

    expect(toEngineHostPathMock).toHaveBeenCalledWith(
      path.resolve(externalRoot),
      { engineHost: 'wsl', wslDistro: 'Ubuntu' },
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      expect.stringMatching(/shared-mcp-compose\.override\.yml\.tmp-/),
      expect.stringContaining(JSON.stringify(translatedRoot)),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('leaves bind sources unchanged for native engine mode', async () => {
    const repoRoot = path.join(path.sep, 'repo');
    const firstRoot = path.join(path.sep, 'external-a');

    await generateSharedMcpComposeOverride(repoRoot, [firstRoot]);

    expect(toEngineHostPathMock).toHaveBeenCalledWith(
      path.resolve(firstRoot),
      {},
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      expect.stringMatching(/shared-mcp-compose\.override\.yml\.tmp-/),
      expect.stringContaining(JSON.stringify(firstRoot)),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('rejects missing external mount roots during override generation', async () => {
    vi.mocked(stat).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(
      generateSharedMcpComposeOverride('/repo', ['/missing']),
    ).rejects.toThrow('ENOENT');
  });

  it('short-circuits ensureSharedMcpRunning when the shared healthcheck is already healthy', async () => {
    mockGetPlatformConfig.mockResolvedValue({ mcp_port: 8817, container_runtime: 'docker' } as never);
    mockCheckServiceHealth.mockResolvedValueOnce({
      service: 'repo-context-mcp',
      healthy: true,
      attempts: 1,
    });

    await ensureSharedMcpRunning('/repo');

    expect(mockCheckServiceHealth).toHaveBeenCalledTimes(1);
    expect(mockCheckServiceHealth).toHaveBeenCalledWith({
      name: 'repo-context-mcp',
      url: 'http://127.0.0.1:8817/health',
      maxRetries: 1,
      retryIntervalMs: 0,
    });
    expect(mockCreateRuntimeFromConfig).not.toHaveBeenCalled();
  });

  it('short-circuits direct runtime only when the PID-owned process is healthy', async () => {
    const runtime = {
      backend: 'direct' as const,
      requiresComposeFile: false,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      container_runtime: 'direct',
      repo_context_mcp_external_mount_roots: [],
    } as never);
    mockCheckServiceHealth.mockResolvedValue({
      service: 'repo-context-mcp',
      healthy: true,
      attempts: 1,
    });
    mockIsDirectMcpHealthy.mockResolvedValue(true);

    await ensureSharedMcpRunning('/repo');

    expect(mockIsDirectMcpHealthy).toHaveBeenCalledWith('/repo', 8817);
    expect(runtime.bootstrap).not.toHaveBeenCalled();
  });

  it('bootstraps with shared compose files and scrubbed env when initial healthcheck fails', async () => {
    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      repo_context_mcp_external_mount_roots: ['/external'],
    } as never);
    mockCheckServiceHealth
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // fast path
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // post-lock re-check
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 });  // post-bootstrap
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    await ensureSharedMcpRunning('/repo');

    expect(runtime.bootstrap).toHaveBeenCalledWith({
      repoRoot: '/repo',
      composeFiles: [
        path.resolve('/repo', 'runtime/docker/compose/docker-compose.yml'),
        path.join('/repo', '.platform-state/runtime/shared-mcp-compose.override.yml'),
      ],
      env: expect.objectContaining({
        REPO_CONTEXT_MCP_PORT: '8817',
        REPO_CONTEXT_MCP_CONTAINER_PORT: '8811',
      }),
    });
    // 3 calls: fast-path check + post-lock re-check + post-bootstrap health verification.
    expect(mockCheckServiceHealth).toHaveBeenCalledTimes(3);
  });

  it('bootstraps direct runtime without writing a compose override', async () => {
    const runtime = {
      backend: 'direct' as const,
      requiresComposeFile: false,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      repo_context_mcp_external_mount_roots: ['/external'],
    } as never);
    mockCheckServiceHealth
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // fast path
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // post-lock re-check
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 });  // post-bootstrap
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    await ensureSharedMcpRunning('/repo');

    expect(writeFile).not.toHaveBeenCalledWith(
      path.join('/repo', '.platform-state/runtime/shared-mcp-compose.override.yml'),
      expect.anything(),
    );
    expect(runtime.bootstrap).toHaveBeenCalledWith({
      repoRoot: '/repo',
      env: expect.objectContaining({
        REPO_CONTEXT_MCP_PORT: '8817',
      }),
    });
  });

  it('throws when shared MCP remains unhealthy after bootstrap', async () => {
    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      repo_context_mcp_external_mount_roots: [],
    } as never);
    mockCheckServiceHealth.mockResolvedValue({
      service: 'repo-context-mcp',
      healthy: false,
      attempts: 1,
      error: 'timeout',
    });
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    await expect(ensureSharedMcpRunning('/repo')).rejects.toThrow(
      'Shared repo-context-mcp failed health check',
    );
  });

  it('sweeps legacy port allocation projects with current runtime compose down', async () => {
    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      composeDown: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      taskA: { port: 8812, taskId: 'taskA', composeProjectName: 'tasksail-task-a' },
      taskB: { port: 8813, taskId: 'taskB' },
      taskC: { port: 8814, taskId: 'taskC', composeProjectName: 'tasksail-task-a' },
      taskD: { port: 8815, taskId: 'taskD', composeProjectName: 'tasksail-task-d' },
    }) as never);

    await sweepLegacyPortAllocationsOnce('/repo-sweep-projects');

    expect(mockCreateRuntimeFromConfig).toHaveBeenCalledWith('/repo-sweep-projects');
    expect(runtime.composeDown).toHaveBeenCalledTimes(2);
    expect(runtime.composeDown).toHaveBeenCalledWith({
      composeFile: path.resolve('/repo-sweep-projects', 'runtime/docker/compose/docker-compose.yml'),
      projectName: 'tasksail-task-a',
    });
    expect(runtime.composeDown).toHaveBeenCalledWith({
      composeFile: path.resolve('/repo-sweep-projects', 'runtime/docker/compose/docker-compose.yml'),
      projectName: 'tasksail-task-d',
    });
    expect(rm).toHaveBeenCalledWith(
      path.join('/repo-sweep-projects', '.platform-state/runtime/port-allocations.json'),
      { force: true },
    );
  });

  it('logs legacy sweep failures and still deletes the allocation file', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      composeDown: vi.fn().mockRejectedValue(new Error('compose failed')),
    };
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({
      taskA: { port: 8812, taskId: 'taskA', composeProjectName: 'tasksail-task-a' },
    }) as never);

    await expect(sweepLegacyPortAllocationsOnce('/repo-sweep-failure')).resolves.toBeUndefined();

    expect(stderrWrite).toHaveBeenCalledWith(
      expect.stringContaining('failed to compose down legacy MCP project tasksail-task-a'),
    );
    expect(rm).toHaveBeenCalledWith(
      path.join('/repo-sweep-failure', '.platform-state/runtime/port-allocations.json'),
      { force: true },
    );

    stderrWrite.mockRestore();
  });

  it('runs the legacy allocation sweep only once per repo root', async () => {
    vi.mocked(readFile).mockResolvedValue('{}' as never);

    await sweepLegacyPortAllocationsOnce('/repo-sweep-once');
    await sweepLegacyPortAllocationsOnce('/repo-sweep-once');

    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('reports whether the active runtime requires container paths', async () => {
    mockCreateRuntimeFromConfig
      .mockResolvedValueOnce({ requiresComposeFile: false } as never)
      .mockResolvedValueOnce({ requiresComposeFile: true } as never);

    await expect(runtimeRequiresContainerPaths('/repo')).resolves.toBe(false);
    await expect(runtimeRequiresContainerPaths('/repo')).resolves.toBe(true);
  });

  it('cross-process bootstrap lock: second caller skips bootstrap after post-lock health re-check succeeds', async () => {
    // Acid test: this test FAILS if the acquireDirLock call is removed from
    // ensureSharedMcpRunning, because without the lock both callers see an
    // unhealthy post-lock re-check and both bootstrap (bootstrap called twice).
    //
    // Two concurrent callers with DISTINCT repoRoots bypass the in-process
    // sharedMcpBootstrapInFlight coalescing map and both reach acquireDirLock.
    // We inject a controllable barrier: caller B's acquireDirLock does not
    // resolve until caller A calls its release function.  This forces the
    // sequencing:
    //   A acquires → A bootstraps → A releases → B acquires → B re-checks
    //   health (healthy) → B skips bootstrap.
    //
    // Without the acquireDirLock guard in production both callers would proceed
    // in parallel, both see unhealthy health, and both call bootstrap → the
    // toHaveBeenCalledTimes(1) assertion fails.

    const repoRootA = '/repo-xproc-lock-barrier-a';
    const repoRootB = '/repo-xproc-lock-barrier-b';

    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      mcp_port: 8817,
      container_runtime: 'docker',
      repo_context_mcp_external_mount_roots: [],
    };
    mockGetPlatformConfig.mockResolvedValue(config as never);
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    // Deferred that B's acquireDirLock awaits.  Resolved when A calls release.
    let unblockB!: () => void;
    const bCanAcquire = new Promise<void>((resolve) => { unblockB = resolve; });

    // acquireDirLock mock:
    //   First invocation  → A acquires immediately; its release fn unblocks B.
    //   Second invocation → B blocks on bCanAcquire, then acquires.
    let acquireCallCount = 0;
    acquireDirLockMock.mockImplementation(async () => {
      acquireCallCount += 1;
      if (acquireCallCount === 1) {
        // Caller A: acquired; release signals B.
        return async () => { unblockB(); };
      }
      // Caller B: blocks until A releases.
      await bCanAcquire;
      return async () => { /* no-op */ };
    });

    // Health sequence:
    //   A – pre-lock: unhealthy → proceeds to acquire
    //   A – post-lock re-check: unhealthy → runs bootstrap
    //   A – post-bootstrap: healthy (consumed by runSharedMcpBootstrap internally)
    //   B – pre-lock: unhealthy → proceeds to acquire (would bootstrap without the lock)
    //   B – post-lock re-check: healthy (peer finished) → skips bootstrap
    mockCheckServiceHealth
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // A pre-lock
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // A post-lock re-check
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 })  // A post-bootstrap
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 }) // B pre-lock
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 }); // B post-lock re-check (healthy)

    // Launch both callers concurrently.
    const firstCall = ensureSharedMcpRunning(repoRootA);
    const secondCall = ensureSharedMcpRunning(repoRootB);

    await Promise.all([firstCall, secondCall]);

    // acquireDirLock must have been called for both callers (proves both reached the lock).
    expect(acquireDirLockMock).toHaveBeenCalledTimes(2);
    // Same lock-dir identity (H3): production locks on the repo-scoped path
    // <repoRoot>/.platform-state/runtime/shared-mcp-bootstrap.lock. A same-REPO
    // two-caller contention test is infeasible in one vitest process (the
    // sharedMcpBootstrapInFlight map coalesces same-repo calls before the FS lock);
    // the real acquireDirLock filesystem mutual exclusion is covered by
    // queue/__tests__/dirLock.test.ts.
    expect(acquireDirLockMock).toHaveBeenCalledWith(
      expect.stringMatching(/repo-xproc-lock-barrier-a[/\\]\.platform-state[/\\]runtime[/\\]shared-mcp-bootstrap\.lock$/),
    );
    expect(acquireDirLockMock).toHaveBeenCalledWith(
      expect.stringMatching(/repo-xproc-lock-barrier-b[/\\]\.platform-state[/\\]runtime[/\\]shared-mcp-bootstrap\.lock$/),
    );
    // Exactly one bootstrap: A bootstrapped; B's post-lock re-check found it healthy and skipped.
    // If the lock were removed, B would also bootstrap → called twice → assertion fails.
    expect(runtime.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('cross-process bootstrap lock: falls back gracefully when lock cannot be acquired', async () => {
    // When acquireDirLock returns null, the bootstrap proceeds anyway with a warning.
    acquireDirLockMock.mockResolvedValue(null);

    const runtime = {
      backend: 'docker' as const,
      requiresComposeFile: true,
      bootstrap: vi.fn().mockResolvedValue(undefined),
    };
    mockGetPlatformConfig.mockResolvedValue({
      mcp_port: 8817,
      container_runtime: 'docker',
      repo_context_mcp_external_mount_roots: [],
    } as never);
    mockCheckServiceHealth
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: false, attempts: 1 })
      .mockResolvedValueOnce({ service: 'repo-context-mcp', healthy: true, attempts: 1 });
    mockCreateRuntimeFromConfig.mockResolvedValue(runtime as never);

    await expect(ensureSharedMcpRunning('/repo-lock-fallback')).resolves.toBeUndefined();

    // Bootstrap ran even without the lock.
    expect(runtime.bootstrap).toHaveBeenCalledTimes(1);
  });
});
