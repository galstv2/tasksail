import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveProvider } from '../../../backend/platform/cli-provider/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('listAvailableContextPacks', () => {
  it('lists context packs from approved configured sources', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-packs-'));
    try {
      const configuredPack = join(tempRoot, 'configured-pack');
      const searchRoot = join(tempRoot, 'search-root');
      const discoveredPack = join(searchRoot, 'orders-estate');
      const monolithPack = join(searchRoot, 'monolith-estate');

      await mkdir(join(configuredPack, 'qmd'), { recursive: true });
      await mkdir(join(discoveredPack, 'qmd'), { recursive: true });
      await mkdir(join(monolithPack, 'qmd'), { recursive: true });
      await writeFile(
        join(configuredPack, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'configured-pack',
          display_name: 'Configured Pack',
          repositories: [{
            repo_id: 'orders-api',
            repo_name: 'Orders API',
            repository_type: 'primary',
            service_name: 'orders-api',
          }],
          primary_working_repo_ids: ['orders-api'],
        }),
      );
      await writeFile(
        join(discoveredPack, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'orders-estate',
          display_name: 'Orders Estate',
          repositories: [{
            repo_id: 'orders-web',
            repo_name: 'Orders Web',
            repository_type: 'support',
          }],
        }),
      );
      await writeFile(
        join(monolithPack, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'monolith-estate',
          display_name: 'Monolith Estate',
          estate_type: 'monolith',
          focusable_areas: [{
            focus_id: 'core',
            focus_name: 'Core Module',
            relative_path: 'src/core',
            focus_type: 'service',
            repository_type: 'primary',
          }],
          primary_focus_area_ids: ['core'],
        }),
      );

      const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(contextPackEnvVars.paths, configuredPack);
      vi.stubEnv(contextPackEnvVars.searchRoots, searchRoot);
      vi.stubEnv('ACTIVE_CONTEXT_PACK_DIR', configuredPack);

      const { listAvailableContextPacks } = await import('./main.contextPackCatalog');
      const response = await listAvailableContextPacks();

      expect(response.action).toBe('contextPack.list');
      expect(response.contextPacks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contextPackId: 'configured-pack',
          contextPackDir: configuredPack,
          isActive: true,
          source: 'configured-path',
          primaryWorkingRepoIds: ['orders-api'],
          focusTargets: [expect.objectContaining({
            repoId: 'orders-api',
            repositoryType: 'primary',
          })],
        }),
        expect.objectContaining({
          contextPackId: 'orders-estate',
          contextPackDir: discoveredPack,
          source: 'search-root',
          focusTargets: [expect.objectContaining({
            repoId: 'orders-web',
            repositoryType: 'support',
          })],
        }),
        expect.objectContaining({
          contextPackId: 'monolith-estate',
          contextPackDir: monolithPack,
          source: 'search-root',
          primaryWorkingRepoIds: ['core'],
          focusTargets: [expect.objectContaining({
            focusId: 'core',
            kind: 'focus-area',
            repositoryType: 'primary',
          })],
        }),
      ]));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
