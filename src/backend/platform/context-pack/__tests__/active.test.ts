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
  });

  afterEach(() => {
    process.env = originalEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeEnv(activeContextPackDir: string): void {
    writeFileSync(path.join(tmpDir, '.env'), `ACTIVE_CONTEXT_PACK_DIR=${activeContextPackDir}\n`);
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
    ).rejects.toThrow('Write operations are limited to the active context pack configured in repo .env.');
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
});
