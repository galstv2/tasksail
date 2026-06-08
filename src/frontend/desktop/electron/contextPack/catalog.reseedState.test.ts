import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';

type MarkerKind = 'none' | 'valid' | 'stale' | 'corrupt';

async function writePack(
  root: string,
  id: string,
  markerKind: MarkerKind,
  seedState: Record<string, unknown> = { state: 'seeded' },
): Promise<string> {
  const contextPackDir = join(root, id);
  await mkdir(join(contextPackDir, 'qmd', 'scope'), { recursive: true });
  await writeFile(
    join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      context_pack_id: id,
      display_name: id,
      qmd_scope_root: 'qmd/scope',
      repositories: [
        {
          repo_id: `${id}-repo`,
          repo_name: `${id} Repo`,
        },
      ],
    }),
  );
  await writeFile(join(contextPackDir, 'qmd', 'scope', 'seed-state.json'), JSON.stringify(seedState));

  const markerPath = join(contextPackDir, '.reseed-in-progress.json');
  if (markerKind === 'valid') {
    await writeFile(markerPath, JSON.stringify({
      started_at: new Date().toISOString(),
      pid: 1234,
      host: 'host-a',
    }));
  } else if (markerKind === 'stale') {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await writeFile(markerPath, JSON.stringify({
      started_at: staleDate.toISOString(),
      pid: 1234,
      host: 'host-a',
    }));
    await utimes(markerPath, staleDate, staleDate);
  } else if (markerKind === 'corrupt') {
    await writeFile(markerPath, JSON.stringify({
      started_at: new Date().toISOString(),
    }));
  }

  return contextPackDir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('listAvailableContextPacks reseed marker state', () => {
  it('reports inProgress only for valid current reseed markers', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'catalog-reseed-state-'));
    try {
      const noMarker = await writePack(tempRoot, 'no-marker', 'none');
      const validMarker = await writePack(tempRoot, 'valid-marker', 'valid');
      const staleMarker = await writePack(tempRoot, 'stale-marker', 'stale');
      const corruptMarker = await writePack(tempRoot, 'corrupt-marker', 'corrupt');
      const bootstrapValidMarker = await writePack(
        tempRoot,
        'bootstrap-valid-marker',
        'valid',
        { state: 'bootstrap-empty', reason: 'new-flow-seed-skipped' },
      );

      const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(contextPackEnvVars.paths, [
        noMarker,
        validMarker,
        staleMarker,
        corruptMarker,
        bootstrapValidMarker,
      ].join(delimiter));
      vi.stubEnv(contextPackEnvVars.searchRoots, '');
      vi.stubEnv('ACTIVE_CONTEXT_PACK_DIR', noMarker);

      const { listAvailableContextPacks } = await import('./catalog');
      const response = await listAvailableContextPacks();
      const byDir = new Map(response.contextPacks.map((entry) => [entry.contextPackDir, entry]));

      const noMarkerEntry = byDir.get(noMarker);
      const validMarkerEntry = byDir.get(validMarker);
      const staleMarkerEntry = byDir.get(staleMarker);
      const corruptMarkerEntry = byDir.get(corruptMarker);
      const bootstrapValidMarkerEntry = byDir.get(bootstrapValidMarker);

      expect(noMarkerEntry).toBeDefined();
      expect(validMarkerEntry).toBeDefined();
      expect(staleMarkerEntry).toBeDefined();
      expect(corruptMarkerEntry).toBeDefined();
      expect(bootstrapValidMarkerEntry).toBeDefined();
      expect(noMarkerEntry!.packSeedStateInfo!.inProgress).toBe(false);
      expect(validMarkerEntry!.packSeedStateInfo!.inProgress).toBe(true);
      expect(staleMarkerEntry!.packSeedStateInfo!.inProgress).toBe(false);
      expect(corruptMarkerEntry!.packSeedStateInfo!.inProgress).toBe(false);
      expect(bootstrapValidMarkerEntry!.packSeedStateInfo).toEqual(expect.objectContaining({
        state: 'bootstrap-empty',
        inProgress: true,
      }));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
