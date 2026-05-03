// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { executeContextPackListRepoTreeAction } from './main.contextPackTree';
import type { ContextPackListRepoTreeResponse, DesktopInvokeResult } from '../src/shared/desktopContract';

const execFileAsync = promisify(execFile);

function makeCatalogResponse(repoLocalPath: string) {
  return {
    action: 'contextPack.list' as const,
    mode: 'read-only' as const,
    message: 'ok',
    activeContextPackDir: '/tmp/context-pack',
    configuredPaths: [],
    searchRoots: [],
    recentContextPackDirs: [],
    contextPacks: [
      {
        contextPackId: 'orders',
        displayName: 'Orders',
        contextPackDir: '/tmp/context-pack',
        manifestPath: null,
        bootstrapReady: true,
        source: 'configured-path' as const,
        isActive: true,
        estateType: 'distributed-platform',
        defaultScopeMode: 'focused' as const,
        repoCount: 1,
        primaryWorkingRepoIds: ['orders-api'],
        focusTargets: [
          {
            focusId: 'orders-api',
            displayName: 'Orders API',
            kind: 'repository' as const,
            repoId: 'orders-api',
            repoLocalPath,
            serviceName: 'orders-api',
            systemLayer: 'backend',
            repoRole: null,
            repositoryType: 'primary' as const,
            relativePath: null,
            focusType: null,
            group: null,
            defaultFocusable: true,
            activationPriority: 0,
            adjacentRepoIds: [],
            adjacentFocusIds: [],
          },
        ],
      },
    ],
  };
}

function getTreeResponse(result: DesktopInvokeResult): ContextPackListRepoTreeResponse {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.response as ContextPackListRepoTreeResponse;
}

describe('executeContextPackListRepoTreeAction', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeRepo(): Promise<string> {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'context-pack-tree-'));
    tempDirs.push(repoRoot);
    await execFileAsync('git', ['init'], { cwd: repoRoot });
    return repoRoot;
  }

  it('lists tree entries with deny-list, gitignore, and operator ignore filtering', async () => {
    const repoRoot = await makeRepo();

    await mkdir(path.join(repoRoot, 'a-dir'));
    await mkdir(path.join(repoRoot, 'b-dir'));
    await mkdir(path.join(repoRoot, 'ignored-by-git'));
    await mkdir(path.join(repoRoot, 'migrations'));
    await mkdir(path.join(repoRoot, 'node_modules'));
    await mkdir(path.join(repoRoot, '.platform-state'), { recursive: true });
    await writeFile(path.join(repoRoot, 'a.ts'), 'export const a = 1;\n');
    await writeFile(path.join(repoRoot, 'b.ts'), 'export const b = 2;\n');
    await writeFile(path.join(repoRoot, 'keep.ts'), 'export const keep = true;\n');
    await writeFile(path.join(repoRoot, 'ignored-by-git.txt'), 'ignored\n');
    await writeFile(path.join(repoRoot, 'bundle.map'), '{}\n');
    await writeFile(path.join(repoRoot, 'types.generated.ts'), 'export type T = string;\n');
    await writeFile(path.join(repoRoot, '.gitignore'), 'ignored-by-git.txt\nignored-by-git/\n');
    await writeFile(
      path.join(repoRoot, '.platform-state', 'deep-focus-ignore.json'),
      JSON.stringify({
        extensions: ['.map'],
        patterns: ['*.generated.*', 'migrations/'],
      }, null, 2),
    );

    const result = await executeContextPackListRepoTreeAction(
      { repoLocalPath: repoRoot },
      {
        catalogProvider: async () => makeCatalogResponse(repoRoot),
      },
    );

    const response = getTreeResponse(result);

    expect(response).toMatchObject({
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: 'Listed repo tree entries.',
      currentPath: '',
      truncated: false,
    });
    expect(response.entries).toEqual([
      { name: 'a-dir', relativePath: 'a-dir', kind: 'directory', hasChildren: true },
      { name: 'b-dir', relativePath: 'b-dir', kind: 'directory', hasChildren: true },
      { name: '.gitignore', relativePath: '.gitignore', kind: 'file', hasChildren: false },
      { name: 'a.ts', relativePath: 'a.ts', kind: 'file', hasChildren: false },
      { name: 'b.ts', relativePath: 'b.ts', kind: 'file', hasChildren: false },
      { name: 'keep.ts', relativePath: 'keep.ts', kind: 'file', hasChildren: false },
    ]);
  });

  it('returns an empty list for unknown repo roots or invalid relative paths', async () => {
    const repoRoot = await makeRepo();

    const unknownRootResult = await executeContextPackListRepoTreeAction(
      { repoLocalPath: repoRoot },
      {
        catalogProvider: async () => makeCatalogResponse('/tmp/not-approved'),
      },
    );
    expect(getTreeResponse(unknownRootResult)).toMatchObject({
      action: 'contextPack.listRepoTree',
      entries: [],
      truncated: false,
    });

    const invalidPathResult = await executeContextPackListRepoTreeAction(
      { repoLocalPath: repoRoot, relativePath: '../secret' },
      {
        catalogProvider: async () => makeCatalogResponse(repoRoot),
      },
    );
    expect(getTreeResponse(invalidPathResult)).toMatchObject({
      action: 'contextPack.listRepoTree',
      entries: [],
      currentPath: '',
      truncated: false,
    });
  });

  it('returns an empty list when the requested directory is missing', async () => {
    const repoRoot = await makeRepo();

    const result = await executeContextPackListRepoTreeAction(
      { repoLocalPath: repoRoot, relativePath: 'missing/subdir' },
      {
        catalogProvider: async () => makeCatalogResponse(repoRoot),
      },
    );

    expect(getTreeResponse(result)).toMatchObject({
      action: 'contextPack.listRepoTree',
      currentPath: 'missing/subdir',
      entries: [],
      truncated: false,
    });
  });

  it('caps tree responses at 500 entries', async () => {
    const repoRoot = await makeRepo();

    for (let index = 0; index < 505; index += 1) {
      await writeFile(path.join(repoRoot, `file-${String(index).padStart(3, '0')}.ts`), 'export {};\n');
    }

    const result = await executeContextPackListRepoTreeAction(
      { repoLocalPath: repoRoot },
      {
        catalogProvider: async () => makeCatalogResponse(repoRoot),
      },
    );

    const response = getTreeResponse(result);

    expect(response).toMatchObject({
      action: 'contextPack.listRepoTree',
      truncated: true,
    });
    expect(response.entries).toHaveLength(500);
  });

  it('filters cross-OS metadata noise even in non-git folders', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-pack-tree-nogit-'));
    tempDirs.push(root);

    await writeFile(path.join(root, '.DS_Store'), '\x00\x00');
    await writeFile(path.join(root, 'Thumbs.db'), '\x00');
    await writeFile(path.join(root, 'desktop.ini'), '[.ShellClassInfo]\n');
    await writeFile(path.join(root, '.directory'), '[Desktop Entry]\n');
    await writeFile(path.join(root, 'app.ts'), 'export const a = 1;\n');
    await mkdir(path.join(root, 'src'));

    const result = await executeContextPackListRepoTreeAction(
      { repoLocalPath: root },
      { catalogProvider: async () => makeCatalogResponse(root) },
    );

    const response = getTreeResponse(result);
    expect(response.entries.map((entry) => entry.name)).toEqual(['src', 'app.ts']);
  });

  it('honors a .gitignore fallback parser when the folder is not a git repo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-pack-tree-nogit-'));
    tempDirs.push(root);

    await writeFile(path.join(root, '.gitignore'), [
      '# secrets and build outputs',
      '',
      '*.secret',
      'build-out/',
      '!keep.secret',
      '/dist',
      'src/inner/skip',
    ].join('\n'));

    await writeFile(path.join(root, 'app.ts'), 'export {};\n');
    await writeFile(path.join(root, 'creds.secret'), 'shh\n');
    await writeFile(path.join(root, 'keep.secret'), 'keep\n');
    await mkdir(path.join(root, 'build-out'));
    await mkdir(path.join(root, 'dist'));
    await mkdir(path.join(root, 'src'));

    const result = await executeContextPackListRepoTreeAction(
      { repoLocalPath: root },
      { catalogProvider: async () => makeCatalogResponse(root) },
    );

    const response = getTreeResponse(result);
    const names = response.entries.map((entry) => entry.name);
    expect(names).not.toContain('creds.secret');
    expect(names).not.toContain('build-out');
    expect(names).not.toContain('dist');
    expect(names).toContain('src');
    expect(names).toContain('app.ts');
    // Negation is intentionally not implemented; rather than risk hiding a
    // legitimate source file, we leave keep.secret visible.
    expect(names).toContain('keep.secret');
  });
});
