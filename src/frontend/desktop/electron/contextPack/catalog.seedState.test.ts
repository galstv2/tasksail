import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';

async function writePack(
  contextPackDir: string,
  seedState: Record<string, unknown>,
): Promise<void> {
  await mkdir(join(contextPackDir, 'qmd', 'scope'), { recursive: true });
  await writeFile(
    join(contextPackDir, 'qmd', 'repo-sources.json'),
    JSON.stringify({
      context_pack_id: 'orders-estate',
      display_name: 'Orders Estate',
      qmd_scope_root: 'qmd/scope',
      repositories: [
        {
          repo_id: 'orders-api',
          repo_name: 'Orders API',
          repository_type: 'primary',
        },
      ],
      primary_working_repo_ids: ['orders-api'],
    }),
  );
  await writeFile(join(contextPackDir, 'qmd', 'scope', 'seed-state.json'), JSON.stringify(seedState));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('listAvailableContextPacks seed-state metadata', () => {
  it('exposes last failure metadata from seed-state.json', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'catalog-seed-state-'));
    const contextPackDir = join(tempRoot, 'orders-estate');
    try {
      await writePack(contextPackDir, {
        state: 'seeded',
        last_failure_at: '2026-05-10T12:00:00+00:00',
        last_failure_reason: 'overall_status=failed',
        last_failure_run_id: 'context-pack-seed-report-20260510T120000Z',
      });

      const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(contextPackEnvVars.paths, contextPackDir);
      vi.stubEnv(contextPackEnvVars.searchRoots, '');
      vi.stubEnv('ACTIVE_CONTEXT_PACK_DIR', contextPackDir);

      const { listAvailableContextPacks } = await import('./catalog');
      const response = await listAvailableContextPacks();
      const entry = response.contextPacks.find((pack) => pack.contextPackDir === contextPackDir);

      expect(entry?.packSeedStateInfo).toEqual(expect.objectContaining({
        lastFailureAt: '2026-05-10T12:00:00+00:00',
        lastFailureReason: 'overall_status=failed',
        lastFailureRunId: 'context-pack-seed-report-20260510T120000Z',
      }));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
