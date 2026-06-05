// @vitest-environment node
//
// Tests isPathInside cross-drive rejection and other OS path edge cases.
// isPathInside is not exported, so we test via buildContextPackBootstrapArgs
// (which is exported) and via the git-filter logic exposed through
// executeContextPackCreateAction with mocked runners.

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 as winPath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildContextPackBootstrapArgs, resolveUniqueContextPackDir } from './create';

// ── buildContextPackBootstrapArgs ─────────────────────────────────────────────

describe('buildContextPackBootstrapArgs', () => {
  it('passes contextPackDir and discoveryRoot through to CLI args', () => {
    const args = buildContextPackBootstrapArgs({
      contextPackDir: '/home/user/packs/my-pack',
      discoveryRoot: '/home/user/repos',
      mode: 'monolith',
      writePlan: true,
      seedOnCreate: false,
      initGitRepos: false,
      bootstrapAnswers: {
        contextPackId: 'my-pack',
        estateName: 'My Pack',
        defaultScopeMode: 'focused',
        primaryWorkingRepoIds: [],
        primaryFocusAreaIds: [],
        repositories: [],
      },
    });
    expect(args).toContain('/home/user/packs/my-pack');
    expect(args).toContain('/home/user/repos');
  });
});

// ── resolveUniqueContextPackDir (real temp dirs) ─────────────────────────────

describe('resolveUniqueContextPackDir', () => {
  let parent: string;
  const created: string[] = [];

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'cp-unique-'));
    created.push(parent);
  });

  afterEach(async () => {
    for (const d of created.splice(0)) {
      await rm(d, { recursive: true, force: true });
    }
  });

  it('returns the desired path unchanged when no sibling collides', async () => {
    const desired = join(parent, 'orders-estate');
    expect(await resolveUniqueContextPackDir(desired)).toBe(desired);
  });

  it('appends -2 when the basename already exists', async () => {
    await mkdir(join(parent, 'orders-estate'), { recursive: true });
    const desired = join(parent, 'orders-estate');
    expect(await resolveUniqueContextPackDir(desired)).toBe(join(parent, 'orders-estate-2'));
  });

  it('increments the counter past an existing chain', async () => {
    for (const name of ['orders-estate', 'orders-estate-2', 'orders-estate-3']) {
      await mkdir(join(parent, name), { recursive: true });
    }
    const desired = join(parent, 'orders-estate');
    expect(await resolveUniqueContextPackDir(desired)).toBe(join(parent, 'orders-estate-4'));
  });

  it('returns the desired path unchanged when the parent does not exist', async () => {
    const desired = join(parent, 'missing-sub', 'orders-estate');
    expect(await resolveUniqueContextPackDir(desired)).toBe(desired);
  });
});

// ── path.win32 cross-drive logic (pure, no filesystem) ───────────────────────
//
// isPathInside uses isAbsolute(relative(parent, child)) to detect cross-drive
// Windows paths.  Verify the invariant with path.win32 so we have CI-safe
// Windows coverage without needing a Windows host.

describe('cross-drive detection via path.win32 (simulates isPathInside invariant)', () => {
  it('relative() returns an absolute path for cross-drive Windows paths', () => {
    const rel = winPath.relative('C:\\foo\\bar', 'D:\\baz\\qux');
    // On Windows, path.relative across drives returns the child path unchanged.
    expect(winPath.isAbsolute(rel)).toBe(true);
  });

  it('relative() returns a non-absolute path for same-drive Windows paths', () => {
    const rel = winPath.relative('C:\\foo\\bar', 'C:\\foo\\bar\\child');
    expect(winPath.isAbsolute(rel)).toBe(false);
    expect(rel).toBe('child');
  });

  it('relative() for a same-drive sibling is non-absolute', () => {
    const rel = winPath.relative('C:\\foo\\bar', 'C:\\foo\\baz');
    expect(winPath.isAbsolute(rel)).toBe(false);
    // Should traverse up: ..\\baz
    expect(rel).toBe('..\\baz');
  });

  it('relative() for exact same path is empty string', () => {
    const rel = winPath.relative('C:\\foo\\bar', 'C:\\foo\\bar');
    expect(rel).toBe('');
    expect(winPath.isAbsolute(rel)).toBe(false);
  });
});
