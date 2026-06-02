import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Proves the container CLI bootstrap path (used by desktop predev / Electron
// service startup) threads a repoRoot-aware merged env into runtime.bootstrap,
// so a repo .env TASKSAIL_PYTHON_BASE_IMAGE override is not bypassed. The real
// createSharedMcpComposeBootstrapEnv runs; only the surrounding runtime, config,
// and CLI boundary are mocked.

const bootstrapSpy = vi.hoisted(() => vi.fn());
const repoRootHolder = vi.hoisted(() => ({ value: '' }));
// Capture main()'s promise so the test can await it and surface any rejection as
// a direct error instead of a confusing vi.waitFor timeout.
const runHolder = vi.hoisted(() => ({ promise: Promise.resolve() }));

vi.mock('../../core/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/index.js')>()),
  findRepoRoot: () => repoRootHolder.value,
  runCliBoundary: (_name: string, fn: () => Promise<void>) => {
    runHolder.promise = fn();
    return runHolder.promise;
  },
  writeProtocolStdout: () => {},
  writeProtocolStderr: () => {},
}));

vi.mock('../../platform-config/seed.js', () => ({
  seedPlatformConfig: vi.fn(async () => ({ action: 'ok', errors: [] })),
}));

vi.mock('../../platform-config/get.js', () => ({
  getPlatformConfig: vi.fn(async () => ({ mcp_port: 8811 })),
}));

vi.mock('../runtime.js', () => ({
  createRuntimeFromConfig: vi.fn(async () => ({
    backend: 'docker',
    requiresComposeFile: true,
    bootstrap: bootstrapSpy,
  })),
}));

vi.mock('../sharedMcp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sharedMcp.js')>()),
  sweepLegacyPortAllocationsOnce: vi.fn(async () => {}),
}));

describe('container cli bootstrap env propagation', () => {
  let argvBackup: string[];
  let savedBaseImage: string | undefined;

  beforeEach(() => {
    bootstrapSpy.mockReset();
    argvBackup = process.argv;
    savedBaseImage = process.env['TASKSAIL_PYTHON_BASE_IMAGE'];
    delete process.env['TASKSAIL_PYTHON_BASE_IMAGE'];
  });

  afterEach(async () => {
    process.argv = argvBackup;
    if (savedBaseImage === undefined) delete process.env['TASKSAIL_PYTHON_BASE_IMAGE'];
    else process.env['TASKSAIL_PYTHON_BASE_IMAGE'] = savedBaseImage;
    vi.resetModules();
    if (repoRootHolder.value) await rm(repoRootHolder.value, { recursive: true, force: true });
  });

  it('threads repo .env TASKSAIL_PYTHON_BASE_IMAGE into runtime.bootstrap env', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'tasksail-cli-bootstrap-'));
    await writeFile(
      join(repoRoot, '.env'),
      'TASKSAIL_PYTHON_BASE_IMAGE=mirror.internal/python:3.12-alpine\n',
      'utf-8',
    );
    repoRootHolder.value = repoRoot;
    process.argv = ['node', 'cli', 'bootstrap'];

    await import('../cli.js');
    // Awaiting main() rethrows any failure with its real stack (clearer than a timeout).
    await runHolder.promise;

    expect(bootstrapSpy).toHaveBeenCalled();
    const options = bootstrapSpy.mock.calls[0][0];
    expect(options.repoRoot).toBe(repoRoot);
    expect(options.env['TASKSAIL_PYTHON_BASE_IMAGE']).toBe('mirror.internal/python:3.12-alpine');
  });
});
