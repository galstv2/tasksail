import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { requireAuthorizedActiveContextPack } from '../active.js';

describe('requireAuthorizedActiveContextPack', () => {
  let tmpDir: string;
  const originalEnv = process.env;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'active-context-pack-test-'));
    process.env = { ...originalEnv };
    // Ensure the task-sidecar path is not taken when testing the singleton path.
    delete process.env['TASKSAIL_TASK_ID'];
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEnv(activeContextPackDir: string): void {
    writeFileSync(path.join(tmpDir, '.env'), `ACTIVE_CONTEXT_PACK_DIR=${activeContextPackDir}\n`);
  }

  function writeWorkspaceSyncState(activeContextPackDir: string): void {
    mkdirSync(path.join(tmpDir, '.platform-state'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, '.platform-state', 'workspace-context-sync.json'),
      JSON.stringify({ active_context_pack_dir: activeContextPackDir }),
    );
  }

  function makeContextPack(name: string): string {
    const packDir = path.join(tmpDir, name);
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    writeFileSync(
      path.join(packDir, 'qmd', 'repo-sources.json'),
      JSON.stringify({ estate_type: 'monolith', repository: { repo_id: name, local_paths: [packDir] } }),
    );
    return packDir;
  }

  it('returns the validated active context pack from repo .env', async () => {
    const packDir = makeContextPack('pack-a');
    writeEnv(packDir);

    await expect(
      requireAuthorizedActiveContextPack({ repoRoot: tmpDir }),
    ).resolves.toBe(packDir);
  });

  it('rejects a requested context pack that differs from the active context pack', async () => {
    const packDir = makeContextPack('pack-a');
    const roguePackDir = makeContextPack('pack-b');
    writeEnv(packDir);

    await expect(
      requireAuthorizedActiveContextPack({
        repoRoot: tmpDir,
        requestedContextPackDir: roguePackDir,
      }),
    ).rejects.toThrow('Write operations are limited to the active context pack.');
  });

  it('rejects when ACTIVE_CONTEXT_PACK_DIR in process env disagrees with repo .env', async () => {
    const packDir = makeContextPack('pack-a');
    const roguePackDir = makeContextPack('pack-b');
    writeEnv(packDir);
    process.env['ACTIVE_CONTEXT_PACK_DIR'] = roguePackDir;

    await expect(
      requireAuthorizedActiveContextPack({ repoRoot: tmpDir }),
    ).rejects.toThrow('ACTIVE_CONTEXT_PACK_DIR does not match the repo .env active context pack.');
  });

  it('falls back to process.env when .env is empty', async () => {
    const packDir = makeContextPack('pack-env');
    writeFileSync(path.join(tmpDir, '.env'), 'ACTIVE_CONTEXT_PACK_DIR=\n');
    process.env['ACTIVE_CONTEXT_PACK_DIR'] = packDir;

    await expect(
      requireAuthorizedActiveContextPack({ repoRoot: tmpDir }),
    ).resolves.toBe(packDir);
  });

  it('falls back to workspace sync state when .env and process.env are empty', async () => {
    const packDir = makeContextPack('pack-sync');
    writeFileSync(path.join(tmpDir, '.env'), 'ACTIVE_CONTEXT_PACK_DIR=\n');
    delete process.env['ACTIVE_CONTEXT_PACK_DIR'];
    writeWorkspaceSyncState(packDir);

    await expect(
      requireAuthorizedActiveContextPack({ repoRoot: tmpDir }),
    ).resolves.toBe(packDir);
  });

  it('rejects a requested context pack that differs from workspace sync state', async () => {
    const packDir = makeContextPack('pack-sync');
    const roguePackDir = makeContextPack('pack-rogue');
    writeFileSync(path.join(tmpDir, '.env'), 'ACTIVE_CONTEXT_PACK_DIR=\n');
    delete process.env['ACTIVE_CONTEXT_PACK_DIR'];
    writeWorkspaceSyncState(packDir);

    await expect(
      requireAuthorizedActiveContextPack({
        repoRoot: tmpDir,
        requestedContextPackDir: roguePackDir,
      }),
    ).rejects.toThrow('Write operations are limited to the active context pack.');
  });

  it('rejects when both .env and process.env are empty', async () => {
    writeFileSync(path.join(tmpDir, '.env'), 'ACTIVE_CONTEXT_PACK_DIR=\n');
    delete process.env['ACTIVE_CONTEXT_PACK_DIR'];

    await expect(
      requireAuthorizedActiveContextPack({ repoRoot: tmpDir }),
    ).rejects.toThrow('No active context pack is configured');
  });
});
