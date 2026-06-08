import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';

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
            repo_category: 'service',
            repo_category_authored: true,
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

      const { listAvailableContextPacks } = await import('./catalog');
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
            repoCategory: 'service',
            repoCategoryAuthored: true,
          })],
        }),
        expect.objectContaining({
          contextPackId: 'orders-estate',
          contextPackDir: discoveredPack,
          source: 'search-root',
          focusTargets: [expect.objectContaining({
            repoId: 'orders-web',
            repositoryType: 'support',
            repoCategory: null,
            repoCategoryAuthored: false,
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
            repoCategory: null,
            repoCategoryAuthored: false,
          })],
        }),
      ]));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to the directory id and logs a parse error for a corrupt manifest', async () => {
    const warnSpy = vi.fn();
    vi.doMock('../log/logger', () => ({
      createLogger: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
        child: vi.fn(),
      }),
    }));
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-packs-corrupt-'));
    try {
      const corruptPack = join(tempRoot, 'corrupt-pack');
      await mkdir(join(corruptPack, 'qmd'), { recursive: true });
      await writeFile(
        join(corruptPack, 'qmd', 'repo-sources.json'),
        '{ "context_pack_id": "corrupt-pack", truncated',
      );

      const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(contextPackEnvVars.paths, corruptPack);
      vi.stubEnv(contextPackEnvVars.searchRoots, '');
      vi.stubEnv('ACTIVE_CONTEXT_PACK_DIR', corruptPack);

      const { listAvailableContextPacks } = await import('./catalog');
      const response = await listAvailableContextPacks();

      expect(response.contextPacks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contextPackId: 'corrupt-pack',
          displayName: 'corrupt-pack',
          contextPackDir: corruptPack,
        }),
      ]));
      expect(warnSpy).toHaveBeenCalledWith(
        'context-pack.catalog.manifest.parse-failed',
        expect.objectContaining({
          contextPackDir: corruptPack,
          manifestPath: join(corruptPack, 'qmd', 'repo-sources.json'),
        }),
      );
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
      vi.doUnmock('../log/logger');
    }
  });

  it('keeps repository focus and repo category as separate catalog fields', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'desktop-context-pack-categories-'));
    try {
      const pack = join(tempRoot, 'orders-estate');
      await mkdir(join(pack, 'qmd'), { recursive: true });
      await writeFile(
        join(pack, 'qmd', 'repo-sources.json'),
        JSON.stringify({
          context_pack_id: 'orders-estate',
          display_name: 'Orders Estate',
          estate_type: 'distributed-platform',
          repositories: [{
            repo_id: 'orders-api',
            repo_name: 'Orders API',
            repository_type: 'support',
            repo_category: 'service',
          }],
        }),
      );

      const contextPackEnvVars = getActiveProvider(process.cwd()).contextPackEnvVars();
      vi.stubEnv(contextPackEnvVars.paths, pack);
      vi.stubEnv(contextPackEnvVars.searchRoots, '');

      const { listAvailableContextPacks } = await import('./catalog');
      const response = await listAvailableContextPacks();

      expect(response.contextPacks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contextPackId: 'orders-estate',
          focusTargets: [expect.objectContaining({
            repoId: 'orders-api',
            repositoryType: 'support',
            repoCategory: 'service',
            repoCategoryAuthored: false,
          })],
        }),
      ]));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
