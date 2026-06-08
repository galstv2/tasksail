// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCreateRequest } from '../../../src/shared/desktopContract';
import {
  executeContextPackCreateAction,
  resolveMonolithLanguages,
} from './create';
import { _fsOps } from './gitignoreTemplates';
import { REPO_ROOT } from '../../paths';

// Module-level mocks — must be declared at this scope, hoisted by Vitest.

const { warn, error, info } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn, error, info })),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

// git init mock — by default succeeds. Tests override via gitInitImpl.
let gitInitImpl: ((args: string[], options: { cwd: string }) => Promise<void>) | null = null;

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: (
      cmd: string,
      args: string[],
      opts: unknown,
      cb?: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      // Only intercept `git init` calls.
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'init') {
        const options = opts as { cwd: string };
        const promise = gitInitImpl
          ? gitInitImpl(args, options)
          : Promise.resolve();
        promise.then(
          () => cb?.(null, '', ''),
          (err: Error) => cb?.(err, '', ''),
        );
        // Return a minimal ChildProcess-like object.
        return {
          stdout: null,
          stderr: null,
          stdin: null,
          on: () => undefined,
          removeListener: () => undefined,
        } as unknown as ReturnType<typeof orig.execFile>;
      }
      // Pass all other execFile calls through.
      return orig.execFile(cmd as never, args as never, opts as never, cb as never);
    },
  };
});

type CreatePayload = ContextPackCreateRequest['payload'];
type RepoInput = CreatePayload['bootstrapAnswers']['repositories'][number];

function repo(overrides: Partial<RepoInput> & { repoRoot: string }): RepoInput {
  return {
    repoName: overrides.repoId ?? 'Repo',
    repoId: overrides.repoId ?? 'repo',
    systemLayer: 'backend',
    ...overrides,
  } as RepoInput;
}

function payload(
  discoveryRoot: string,
  contextPackDir: string,
  mode: CreatePayload['mode'],
  repositories: RepoInput[],
  extra: Partial<CreatePayload> = {},
  focusableAreas?: NonNullable<CreatePayload['bootstrapAnswers']['focusableAreas']>,
): CreatePayload {
  return {
    contextPackDir: makeOwnedContextPackDir(basename(contextPackDir)),
    discoveryRoot,
    mode,
    seedOnCreate: false,
    initGitRepos: true,
    bootstrapAnswers: {
      contextPackId: 'pack',
      estateName: 'Pack',
      repositories,
      ...(focusableAreas ? { focusableAreas } : {}),
    },
    ...extra,
  };
}

function okPreflightRunner() {
  return vi.fn().mockResolvedValue({
    stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }),
    stderr: '',
  });
}

function okBootstrapRunner(estateType = 'distributed') {
  return vi.fn().mockResolvedValue({
    stdout: JSON.stringify({
      context_pack_id: 'pack',
      estate_type: estateType,
      primary_working_repo_ids: [],
      primary_focus_area_ids: [],
      warnings: [],
    }),
    stderr: '',
  });
}

function okPlanRunner() {
  return vi.fn().mockResolvedValue({ stdout: JSON.stringify({ overall_status: 'ok' }), stderr: '' });
}

async function runCreate(p: CreatePayload, estateType = p.mode): Promise<ReturnType<typeof executeContextPackCreateAction>> {
  return executeContextPackCreateAction(
    p,
    okBootstrapRunner(estateType),
    okPlanRunner(),
    vi.fn().mockResolvedValue({ stdout: JSON.stringify({ overall_status: 'ok' }), stderr: '' }),
    okPreflightRunner(),
  );
}

let tempRoots: string[] = [];
let contextPackDirs: string[] = [];
let contextPackCounter = 0;

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'cp-gi-create-'));
  tempRoots.push(dir);
  return dir;
}

function makeOwnedContextPackDir(label: string): string {
  const dir = join(
    REPO_ROOT,
    'contextpacks',
    `vitest-create-${process.pid}-${contextPackCounter++}-${label}`,
  );
  contextPackDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  gitInitImpl = null;
  const dirs = [...tempRoots, ...contextPackDirs];
  tempRoots = [];
  contextPackDirs = [];
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

describe('resolveMonolithLanguages — standalone helper', () => {
  it('returns languages of the repo matching discoveryRoot', () => {
    const repos = [
      repo({ repoRoot: '/a/other', repoId: 'other', languages: ['python'] }),
      repo({ repoRoot: '/a/mono', repoId: 'mono', languages: ['typescript', 'go'] }),
    ] as Parameters<typeof resolveMonolithLanguages>[0];
    expect(resolveMonolithLanguages(repos, '/a/mono')).toEqual(['typescript', 'go']);
  });

  it('returns undefined when no repo matches discoveryRoot', () => {
    const repos = [
      repo({ repoRoot: '/a/other', repoId: 'other', languages: ['python'] }),
    ] as Parameters<typeof resolveMonolithLanguages>[0];
    expect(resolveMonolithLanguages(repos, '/a/mono')).toBeUndefined();
  });

  it('returns empty array when matching repo has no languages', () => {
    const repos = [
      repo({ repoRoot: '/a/mono', repoId: 'mono' }),
    ] as Parameters<typeof resolveMonolithLanguages>[0];
    expect(resolveMonolithLanguages(repos, '/a/mono')).toEqual([]);
  });
});

describe('create ownership guard', () => {
  it('rejects creation outside TaskSail-managed contextpacks before preflight', async () => {
    const root = await makeTempRoot();
    const p = payload(
      join(root, 'source'),
      join(root, 'context-packs', 'outside-pack'),
      'distributed',
      [repo({ repoRoot: join(root, 'source'), repoId: 'source' })],
    );
    p.contextPackDir = join(root, 'context-packs', 'outside-pack');

    const bootstrapRunner = vi.fn();
    const planRunner = vi.fn();
    const seedRunner = vi.fn();
    const preflightRunner = vi.fn();
    const result = await executeContextPackCreateAction(
      p,
      bootstrapRunner,
      planRunner,
      seedRunner,
      preflightRunner,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toContain('TaskSail-managed contextpacks');
    expect(preflightRunner).not.toHaveBeenCalled();
    expect(bootstrapRunner).not.toHaveBeenCalled();
    expect(planRunner).not.toHaveBeenCalled();
    expect(seedRunner).not.toHaveBeenCalled();
  });
});

describe('create gitignore — distributed repos', () => {
  it('distributed Python repo gets default + python .gitignore after git init', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'api');
    await mkdir(repoDir, { recursive: true });

    const result = await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'api', languages: ['python'] }),
      ]),
    );

    expect(result.ok).toBe(true);
    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    expect(content).toContain('__pycache__/');
    expect(content).toContain('.venv/');
  });

  it('distributed TypeScript repo gets default + TS rules and does not ignore lockfiles', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'web');
    await mkdir(repoDir, { recursive: true });

    await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'web', languages: ['typescript'] }),
      ]),
    );

    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).not.toMatch(/^package-lock\.json$/m);
    expect(content).not.toMatch(/^yarn\.lock$/m);
    expect(content).not.toMatch(/^pnpm-lock\.yaml$/m);
  });

  it('custom/unknown language gets default only', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'docs');
    await mkdir(repoDir, { recursive: true });

    await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'docs', languages: ['custom'] }),
      ]),
    );

    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    expect(content).not.toContain('node_modules/');
    expect(content).not.toContain('__pycache__/');
  });

  it('pre-existing .gitignore is preserved byte-for-byte and logged as exists', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'api');
    await mkdir(repoDir, { recursive: true });
    const original = '# operator-written\n*.secret\n';
    await writeFile(join(repoDir, '.gitignore'), original, 'utf8');

    await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'api', languages: ['python'] }),
      ]),
    );

    const after = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(after).toBe(original);
    expect(info).toHaveBeenCalledWith(
      'context-pack.create.gitignore.exists',
      expect.objectContaining({ repoDir: resolve(repoDir) }),
    );
  });

  it('concurrent EEXIST during create preserves competing content', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'api');
    await mkdir(repoDir, { recursive: true });
    const competing = '# written by another process\n*.tmp\n';

    // Intercept _fsOps.open so that right before the exclusive open, we write competing content,
    // making the real open fail with EEXIST.
    const realOpen = _fsOps.open.bind(_fsOps);
    vi.spyOn(_fsOps, 'open').mockImplementationOnce(async (p, flag) => {
      if (typeof p === 'string' && p.endsWith('.gitignore') && flag === 'wx') {
        await writeFile(p as string, competing, 'utf8');
      }
      return realOpen(p as Parameters<typeof realOpen>[0], flag as Parameters<typeof realOpen>[1]);
    });

    await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'api', languages: ['go'] }),
      ]),
    );

    const after = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(after).toBe(competing);
  });

  it('git init failure does not write .gitignore and does not emit a created log', async () => {
    const root = await makeTempRoot();
    const repoDir = join(root, 'api');
    await mkdir(repoDir, { recursive: true });

    // Force git init to fail for this test.
    gitInitImpl = async () => {
      throw Object.assign(new Error('git init failed'), { code: 'ENOENT', stderr: 'git: command not found' });
    };

    const result = await runCreate(
      payload(join(root, 'estate'), join(root, 'pack'), 'distributed', [
        repo({ repoRoot: repoDir, repoId: 'api', languages: ['python'] }),
      ]),
    );

    expect(result.ok).toBe(false);
    // No .gitignore created.
    try {
      await readFile(join(repoDir, '.gitignore'), 'utf8');
      expect.fail('Should not have created .gitignore after git init failure');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
    expect(info).not.toHaveBeenCalledWith('context-pack.create.gitignore.created', expect.anything());
  });
});

describe('create gitignore — monolith modes', () => {
  it('monolith root with Python+TS gets one root .gitignore with both sections', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'mono');
    await mkdir(discoveryRoot, { recursive: true });

    const result = await runCreate(
      payload(discoveryRoot, join(root, 'pack'), 'monolith', [
        repo({ repoRoot: discoveryRoot, repoId: 'mono', languages: ['python', 'typescript'] }),
      ]),
      'monolith',
    );

    expect(result.ok).toBe(true);
    const content = await readFile(join(discoveryRoot, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    expect(content).toContain('__pycache__/');
    expect(content).toContain('node_modules/');

    try {
      await readFile(join(discoveryRoot, 'focus', '.gitignore'), 'utf8');
      expect.fail('Should not have nested .gitignore');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('monolith-platform writes one .gitignore at discoveryRoot and one at the separate infra repo', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'app');
    const infraRoot = join(root, 'infra');
    await mkdir(discoveryRoot, { recursive: true });
    await mkdir(infraRoot, { recursive: true });

    const result = await runCreate(
      payload(discoveryRoot, join(root, 'pack'), 'monolith-platform', [
        repo({ repoRoot: discoveryRoot, repoId: 'app', languages: ['typescript'] }),
        repo({ repoRoot: infraRoot, repoId: 'infra', languages: ['hcl'] }),
      ]),
      'monolith-platform',
    );

    expect(result.ok).toBe(true);
    const appContent = await readFile(join(discoveryRoot, '.gitignore'), 'utf8');
    expect(appContent).toContain('node_modules/');

    const infraContent = await readFile(join(infraRoot, '.gitignore'), 'utf8');
    expect(infraContent).toContain('.terraform/');
  });

  it('monolith-platform side repo inside monolith root is skipped (no nested .gitignore)', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'mono');
    const innerRepo = join(discoveryRoot, 'packages', 'inner');
    await mkdir(innerRepo, { recursive: true });

    const result = await runCreate(
      payload(discoveryRoot, join(root, 'pack'), 'monolith-platform', [
        repo({ repoRoot: discoveryRoot, repoId: 'mono', languages: ['python'] }),
        repo({ repoRoot: innerRepo, repoId: 'inner', languages: ['javascript'] }),
      ]),
      'monolith-platform',
    );

    expect(result.ok).toBe(true);
    const rootContent = await readFile(join(discoveryRoot, '.gitignore'), 'utf8');
    expect(rootContent).toContain('.env');

    try {
      await readFile(join(innerRepo, '.gitignore'), 'utf8');
      expect.fail('Should not have created nested .gitignore inside monolith root');
    } catch (err: unknown) {
      expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('perturbed repo order still selects languages by repoRoot matching discoveryRoot', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'app');
    const infraRoot = join(root, 'infra');
    await mkdir(discoveryRoot, { recursive: true });
    await mkdir(infraRoot, { recursive: true });

    const result = await runCreate(
      payload(discoveryRoot, join(root, 'pack'), 'monolith-platform', [
        repo({ repoRoot: infraRoot, repoId: 'infra', languages: ['hcl'] }),
        repo({ repoRoot: discoveryRoot, repoId: 'app', languages: ['ruby'] }),
      ]),
      'monolith-platform',
    );

    expect(result.ok).toBe(true);
    const rootContent = await readFile(join(discoveryRoot, '.gitignore'), 'utf8');
    expect(rootContent).toContain('coverage/');  // ruby sentinel
    expect(rootContent).not.toContain('.terraform/');  // hcl sentinel should not appear at root
  });

  it('malformed monolith (no repoRoot matching discoveryRoot) fails before any monolith git init', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'app');
    const otherRoot = join(root, 'other');
    await mkdir(discoveryRoot, { recursive: true });
    await mkdir(otherRoot, { recursive: true });

    let gitInitCallCount = 0;
    gitInitImpl = async () => {
      gitInitCallCount++;
    };

    const result = await runCreate(
      payload(discoveryRoot, join(root, 'pack'), 'monolith', [
        repo({ repoRoot: otherRoot, repoId: 'other', languages: ['python'] }),
      ]),
      'monolith',
    );

    expect(result.ok).toBe(false);
    const errMsg = (result as { error: string }).error;
    expect(errMsg).toMatch(/discoveryRoot/);

    expect(gitInitCallCount).toBe(0);

    for (const dir of [discoveryRoot, otherRoot]) {
      try {
        await readFile(join(dir, '.gitignore'), 'utf8');
        expect.fail(`Should not have created .gitignore at ${dir}`);
      } catch (err: unknown) {
        expect((err as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
    }
  });
});

describe('create — focus area subdirectories (monolith)', () => {
  it('materializes a declared focus-area subdirectory inside the monolith root', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'mono');
    await mkdir(discoveryRoot, { recursive: true });
    const focusPath = join(discoveryRoot, 'crud-app');

    const result = await runCreate(
      payload(
        discoveryRoot,
        join(root, 'pack'),
        'monolith',
        [repo({ repoRoot: discoveryRoot, repoId: 'mono', languages: ['typescript'] })],
        {},
        [{ focusId: 'crud-app', relativePath: 'crud-app', path: focusPath }],
      ),
      'monolith',
    );

    expect(result.ok).toBe(true);
    expect((await stat(focusPath)).isDirectory()).toBe(true);
  });

  it('does not create a focus-area path that resolves outside the monolith root', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'mono');
    await mkdir(discoveryRoot, { recursive: true });
    const outsidePath = join(root, 'evil'); // sibling of the root, not inside it

    await runCreate(
      payload(
        discoveryRoot,
        join(root, 'pack'),
        'monolith',
        [repo({ repoRoot: discoveryRoot, repoId: 'mono', languages: ['python'] })],
        {},
        [{ focusId: 'evil', relativePath: '../evil', path: outsidePath }],
      ),
      'monolith',
    );

    await expect(stat(outsidePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('tolerates a focus area with no path without crashing', async () => {
    const root = await makeTempRoot();
    const discoveryRoot = join(root, 'mono');
    await mkdir(discoveryRoot, { recursive: true });

    const result = await runCreate(
      payload(
        discoveryRoot,
        join(root, 'pack'),
        'monolith',
        [repo({ repoRoot: discoveryRoot, repoId: 'mono', languages: ['go'] })],
        {},
        [{ focusId: 'nopath', relativePath: 'nopath' }],
      ),
      'monolith',
    );

    expect(result.ok).toBe(true);
  });
});
