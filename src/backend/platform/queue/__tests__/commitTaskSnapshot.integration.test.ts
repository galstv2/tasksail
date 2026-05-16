/**
 * Spec §6.7 integration test for Fix G (snapshot pathspec hardening).
 *
 * Scope: drives the full snapshot subsystem end-to-end against a real git
 * worktree and a real context-pack JSON file on disk. Asserts that the
 * resulting `task/<id>` commit contains exactly the source changes operators
 * expect and none of the build/cache noise.
 *
 * NOT in scope: this test does not invoke `completePendingItem` end-to-end —
 * doing so would require the full archive/retrospective/finalize/lock harness
 * (Python archive script, context-pack activation, queue locks, pendingitems
 * machinery), which provides no additional coverage over the snapshot pathspec
 * assertion this case is designed to prove. The audit treats `commitTaskSnapshot`
 * as the system-under-test for Fix G; the surrounding closeout steps are
 * covered by their own dedicated tests (resumeCloseout, completePendingItem,
 * pipelineSupervisor).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { commitTaskSnapshot } from '../errorItems.js';
import type { TaskJson } from '../taskJson.js';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

describe('commitTaskSnapshot integration (spec §6.7)', () => {
  let repoRoot: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'tq-commit-snapshot-int-'));
    git(repoRoot, ['init']);
    git(repoRoot, ['config', 'user.email', 'test@example.invalid']);
    git(repoRoot, ['config', 'user.name', 'Test User']);
    // Minimal .gitignore — operator excludes node_modules/ but NOT bin/.
    writeFileSync(path.join(repoRoot, '.gitignore'), 'node_modules/\n');
    writeFileSync(path.join(repoRoot, 'README.md'), '# integration\n');
    writeFileSync(path.join(repoRoot, 'src.ts'), 'export const baseline = 0;\n');
    git(repoRoot, ['add', '.gitignore', 'README.md', 'src.ts']);
    git(repoRoot, ['commit', '-m', 'init']);
    warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('full closeout snapshot path with noise produces a clean task/<id> commit', async () => {
    const taskId = 'task-integration';
    const branch = `task/${taskId}`;
    const worktreeRoot = path.join(repoRoot, '.task-worktrees', taskId);
    mkdirSync(path.dirname(worktreeRoot), { recursive: true });
    git(repoRoot, ['worktree', 'add', '-b', branch, worktreeRoot]);
    const baseSha = git(repoRoot, ['rev-parse', 'HEAD']).trim();

    // Real on-disk context pack with platform-shaped filters.
    const contextPackPath = path.join(repoRoot, 'context-pack.json');
    writeFileSync(contextPackPath, JSON.stringify({
      snapshot_filters: {
        additional_deny_globs: ['**/proprietary-vendor-cache/**'],
        allow_overrides: ['dist/published-package/**'],
      },
    }));

    // Real on-disk .task.json sidecar — same shape `commitTaskSnapshot` reads
    // in production via `readTaskJson(taskId, repoRoot)`.
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    const sidecar: TaskJson = {
      schema_version: 2,
      taskId,
      contextPackBinding: {
        contextPackPath,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: [
          {
            originalRoot: repoRoot,
            worktreeRoot,
            worktreeBranch: branch,
            baseCommitSha: baseSha,
          },
        ],
      },
      materialization: { strategy: 'copy', cloned: [], skipped: [] },
      frozenAt: new Date().toISOString(),
      finalizedAt: null,
      state: 'active',
    };
    writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify(sidecar));

    // Simulated Dalton edits + noise of every kind:
    // 1. Real source edit (must be committed)
    writeFileSync(path.join(worktreeRoot, 'src.ts'), 'export const baseline = 1;\n');
    writeFileSync(path.join(worktreeRoot, 'feature.ts'), 'export const feat = true;\n');

    // 2. Default-denylist build artifact NOT covered by .gitignore — must NOT
    //    be committed; SHOULD surface in the warning.
    mkdirSync(path.join(worktreeRoot, 'bin', 'Debug', 'net8.0'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'bin', 'Debug', 'net8.0', 'Acme.dll'), 'dll');

    // 3. Default-denylist artifact ALREADY covered by .gitignore — must NOT
    //    be committed; SHOULD NOT surface in the warning.
    mkdirSync(path.join(worktreeRoot, 'node_modules', 'lodash'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'node_modules', 'lodash', 'index.js'), 'noise');

    // 4. additional_deny_globs target — must NOT be committed.
    mkdirSync(path.join(worktreeRoot, 'proprietary-vendor-cache'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'proprietary-vendor-cache', 'data.bin'), 'vendor');

    // 5. allow_overrides target — denylist matches `**/dist/**`, override
    //    re-includes `dist/published-package/**`. Must be committed.
    mkdirSync(path.join(worktreeRoot, 'dist', 'published-package'), { recursive: true });
    writeFileSync(path.join(worktreeRoot, 'dist', 'published-package', 'index.js'), 'export {}\n');
    // Sibling `dist/junk.js` is denylist-only (no override) — must NOT be committed.
    writeFileSync(path.join(worktreeRoot, 'dist', 'junk.js'), 'noise\n');

    const ok = await commitTaskSnapshot(repoRoot, taskId, 'completed');
    expect(ok).toBe(true);

    // Exactly one snapshot commit on the task branch.
    const newCommits = git(repoRoot, ['rev-list', '--count', `${baseSha}..${branch}`]).trim();
    expect(newCommits).toBe('1');

    // git show --stat on the tip lists the source changes + override; not the noise.
    const stat = git(repoRoot, ['show', '--name-only', '--pretty=format:', branch]);
    const files = stat.split('\n').map((s) => s.trim()).filter(Boolean).sort();

    expect(files).toContain('src.ts');
    expect(files).toContain('feature.ts');
    expect(files).toContain('dist/published-package/index.js');

    expect(files.some((f) => f.startsWith('bin/'))).toBe(false);
    expect(files.some((f) => f.startsWith('node_modules/'))).toBe(false);
    expect(files.some((f) => f.startsWith('proprietary-vendor-cache/'))).toBe(false);
    expect(files).not.toContain('dist/junk.js');

    // Commit message reflects the outcome label.
    const msg = git(repoRoot, ['log', '-1', '--pretty=%s', branch]).trim();
    expect(msg).toBe(`[tasksail] ${taskId}: completed`);

    // Noise warning surfaces files NOT covered by .gitignore (bin/, dist/junk,
    // proprietary-vendor-cache/) and does NOT mention node_modules/ (gitignored).
    const warnings = warnSpy.mock.calls.flat().map(String).join('\n');
    expect(warnings).toContain('bin/Debug/net8.0/Acme.dll');
    expect(warnings).toContain('proprietary-vendor-cache/data.bin');
    expect(warnings).not.toContain('node_modules/');
  });
});
