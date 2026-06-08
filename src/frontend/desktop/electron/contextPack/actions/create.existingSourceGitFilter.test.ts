// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCreateRequest } from '../../../src/shared/desktopContract';

const warn = vi.fn();
const error = vi.fn();

vi.mock('../../log/logger', () => ({
  createLogger: vi.fn(() => ({ warn, error })),
}));

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}));

// create.ts gates contextPackDir to <REPO_ROOT>/contextpacks; point REPO_ROOT at
// each test's temp root so the ownership guard passes (set in the payload() helper).
const pathsMock = vi.hoisted(() => ({ repoRoot: '' }));
vi.mock('../../paths', () => ({
  get REPO_ROOT() {
    return pathsMock.repoRoot;
  },
}));

type CreatePayload = ContextPackCreateRequest['payload'];
type RepoInput = CreatePayload['bootstrapAnswers']['repositories'][number];

function okPreflightRunner() {
  return vi.fn().mockResolvedValue({
    stdout: JSON.stringify({ ok: true, errors: [], warnings: [] }),
    stderr: '',
  });
}

function okBootstrapRunner(overrides: Record<string, unknown> = {}) {
  return vi.fn().mockResolvedValue({
    stdout: JSON.stringify({
      context_pack_id: 'pack',
      estate_type: 'distributed',
      primary_working_repo_ids: [],
      primary_focus_area_ids: [],
      warnings: [],
      ...overrides,
    }),
    stderr: '',
  });
}

function bootstrapStdin(runner: ReturnType<typeof vi.fn>): {
  repositories: Array<Record<string, unknown>>;
  primary_working_repo_ids?: string[];
  focusable_areas?: Array<Record<string, unknown>>;
} {
  const call = runner.mock.calls[0];
  return JSON.parse((call?.[1] as { stdin: string }).stdin);
}

function repo(overrides: Partial<RepoInput> & { repoRoot: string }): RepoInput {
  return {
    repoName: overrides.repoId ?? 'Repo',
    repoId: 'repo',
    systemLayer: 'backend',
    ...overrides,
  } as RepoInput;
}

function payload(
  discoveryRoot: string,
  contextPackDir: string,
  mode: CreatePayload['mode'],
  repositories: RepoInput[],
  extra: Partial<CreatePayload['bootstrapAnswers']> = {},
): CreatePayload {
  // Tests pass contextPackDir as <tmpRoot>/pack. Point the mocked REPO_ROOT at
  // <tmpRoot> and nest the pack under contextpacks/ so the ownership guard passes.
  const tmpRoot = dirname(contextPackDir);
  pathsMock.repoRoot = tmpRoot;
  return {
    contextPackDir: join(tmpRoot, 'contextpacks', basename(contextPackDir)),
    discoveryRoot,
    mode,
    seedOnCreate: false,
    bootstrapAnswers: {
      contextPackId: 'pack',
      estateName: 'Pack',
      repositories,
      ...extra,
    },
  };
}

const MISSING_GIT_FRAGMENT = 'does not have .git folder';

describe('create-time existing-source Git guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distributed: filters the non-Git repo and warns, passing only the valid repo to bootstrap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, 'api', '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner();

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed', [
          repo({ repoRoot: join(discoveryRoot, 'api'), repoId: 'api' }),
          repo({ repoRoot: join(discoveryRoot, 'web'), repoId: 'web' }),
        ]),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result.ok).toBe(true);
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(bootstrapStdin(bootstrap).repositories.map((r) => r.repo_id)).toEqual(['api']);
      const warnings = (result as { response: { result: { warnings: string[] } } }).response.result.warnings;
      expect(warnings.some((w) => w.includes('repo web') && w.includes(MISSING_GIT_FRAGMENT))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('distributed-platform: applies the same filtering and warning behavior', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, 'api', '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner({ estate_type: 'distributed-platform' });

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed-platform', [
          repo({ repoRoot: join(discoveryRoot, 'api'), repoId: 'api' }),
          repo({ repoRoot: join(discoveryRoot, 'web'), repoId: 'web' }),
        ]),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result.ok).toBe(true);
      expect(bootstrapStdin(bootstrap).repositories.map((r) => r.repo_id)).toEqual(['api']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('distributed: fails before bootstrap when no repo has a Git marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(discoveryRoot, { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner();

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed', [
          repo({ repoRoot: join(discoveryRoot, 'api'), repoId: 'api' }),
          repo({ repoRoot: join(discoveryRoot, 'web'), repoId: 'web' }),
        ]),
        bootstrap,
        vi.fn(),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result).toMatchObject({
        ok: false,
        errorCode: 'preflight-failed',
        preflightErrors: [expect.objectContaining({ code: 'repo-missing-top-level-git' })],
      });
      expect(bootstrap).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preflight failure is returned unchanged and the Git guard does not run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = vi.fn();
      const preflight = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          ok: false,
          errors: [
            {
              code: 'path-not-found',
              field: 'bootstrapAnswers.repositories[0].repoRoot',
              message: 'repoRoot does not exist or is not a directory: /no/such/path',
              details: { path: '/no/such/path' },
            },
          ],
          warnings: [],
        }),
        stderr: '',
      });

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed', [
          repo({ repoRoot: '/no/such/path', repoId: 'api' }),
        ]),
        bootstrap,
        vi.fn(),
        vi.fn(),
        preflight,
      );

      expect(result).toMatchObject({
        ok: false,
        errorCode: 'preflight-failed',
        preflightErrors: [expect.objectContaining({ code: 'path-not-found' })],
      });
      expect(bootstrap).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('monolith: fails before bootstrap when repository index 0 lacks a Git marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(discoveryRoot, { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner({ estate_type: 'monolith' });

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'monolith', [
          repo({ repoRoot: discoveryRoot, repoId: 'mono' }),
        ]),
        bootstrap,
        vi.fn(),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result).toMatchObject({
        ok: false,
        errorCode: 'preflight-failed',
        preflightErrors: [expect.objectContaining({ code: 'repo-missing-top-level-git' })],
      });
      expect(bootstrap).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('monolith: accepts a subtree of a Git repo whose .git lives in an ancestor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const monorepo = join(root, 'monorepo');
      await mkdir(join(monorepo, '.git'), { recursive: true });
      const subtree = join(monorepo, 'services', 'billing');
      await mkdir(subtree, { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner({ estate_type: 'monolith' });

      const result = await executeContextPackCreateAction(
        payload(subtree, join(root, 'pack'), 'monolith', [
          repo({ repoRoot: subtree, repoId: 'billing' }),
        ]),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result.ok).toBe(true);
      expect(bootstrap).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('monolith-platform: preserves a valid index 0, filters the invalid side repo, and keeps focusable areas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner({ estate_type: 'monolith-platform' });

      const result = await executeContextPackCreateAction(
        payload(
          discoveryRoot,
          join(root, 'pack'),
          'monolith-platform',
          [
            repo({ repoRoot: discoveryRoot, repoId: 'app' }),
            repo({ repoRoot: join(root, 'infra'), repoId: 'infra' }),
          ],
          {
            primaryWorkingRepoIds: ['app', 'infra'],
            focusableAreas: [
              {
                focusId: 'core',
                focusName: 'Core',
                relativePath: '.',
                path: discoveryRoot,
                focusType: 'service',
              },
            ],
          },
        ),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result.ok).toBe(true);
      const stdin = bootstrapStdin(bootstrap);
      expect(stdin.repositories.map((r) => r.repo_id)).toEqual(['app']);
      expect(stdin.primary_working_repo_ids).toEqual(['app']);
      expect(stdin.focusable_areas).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('new-project (initGitRepos true) bypasses the guard: non-Git repos reach bootstrap unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      const { executeContextPackCreateAction } = await import('./create');
      // Malformed bootstrap output halts the flow before initGitReposForNewProject
      // runs, so we can assert the unfiltered repos reached bootstrap hermetically.
      const bootstrap = vi.fn().mockResolvedValue({ stdout: '{not-json', stderr: '' });

      await executeContextPackCreateAction(
        {
          ...payload(discoveryRoot, join(root, 'pack'), 'distributed', [
            repo({ repoRoot: join(discoveryRoot, 'new-api'), repoId: 'new-api' }),
            repo({ repoRoot: join(discoveryRoot, 'new-web'), repoId: 'new-web' }),
          ]),
          initGitRepos: true,
        },
        bootstrap,
        vi.fn(),
        vi.fn(),
        okPreflightRunner(),
      );

      // Guard bypassed: both non-Git repos were forwarded to bootstrap.
      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(bootstrapStdin(bootstrap).repositories.map((r) => r.repo_id)).toEqual([
        'new-api',
        'new-web',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a .git file (worktree/submodule) as a valid marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, 'api'), { recursive: true });
      await writeFile(join(discoveryRoot, 'api', '.git'), 'gitdir: /elsewhere/.git/worktrees/api\n');
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner();

      const result = await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed', [
          repo({ repoRoot: join(discoveryRoot, 'api'), repoId: 'api' }),
        ]),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(result.ok).toBe(true);
      expect(bootstrapStdin(bootstrap).repositories.map((r) => r.repo_id)).toEqual(['api']);
      const warnings = (result as { response: { result: { warnings: string[] } } }).response.result.warnings;
      expect(warnings.some((w) => w.includes(MISSING_GIT_FRAGMENT))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('drops skipped repo IDs from primaryWorkingRepoIds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, 'api', '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner();

      await executeContextPackCreateAction(
        payload(
          discoveryRoot,
          join(root, 'pack'),
          'distributed',
          [
            repo({ repoRoot: join(discoveryRoot, 'api'), repoId: 'api' }),
            repo({ repoRoot: join(discoveryRoot, 'web'), repoId: 'web' }),
          ],
          { primaryWorkingRepoIds: ['api', 'web'] },
        ),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      expect(bootstrapStdin(bootstrap).primary_working_repo_ids).toEqual(['api']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('prunes skipped repo IDs from relationship arrays on remaining repositories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cp-git-guard-'));
    try {
      const discoveryRoot = join(root, 'estate');
      await mkdir(join(discoveryRoot, 'api', '.git'), { recursive: true });
      const { executeContextPackCreateAction } = await import('./create');
      const bootstrap = okBootstrapRunner();

      await executeContextPackCreateAction(
        payload(discoveryRoot, join(root, 'pack'), 'distributed', [
          repo({
            repoRoot: join(discoveryRoot, 'api'),
            repoId: 'api',
            adjacentRepoIds: ['web', 'api'],
            dependsOnRepoIds: ['web'],
            usedByRepoIds: ['web'],
          }),
          repo({ repoRoot: join(discoveryRoot, 'web'), repoId: 'web' }),
        ]),
        bootstrap,
        vi.fn().mockResolvedValue({ stdout: '{}', stderr: '' }),
        vi.fn(),
        okPreflightRunner(),
      );

      const apiEntry = bootstrapStdin(bootstrap).repositories[0];
      expect(apiEntry?.adjacent_repo_ids).toEqual(['api']);
      expect(apiEntry?.depends_on_repo_ids).toEqual([]);
      expect(apiEntry?.used_by_repo_ids).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
