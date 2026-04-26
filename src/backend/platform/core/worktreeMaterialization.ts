/**
 * §4.14 Worktree + dependency materialization.
 *
 * Exports:
 *   - materializeWorktreeDeps  — CoW-clone dependency dirs into a fresh worktree.
 *   - detectCloneStrategy      — Filesystem-aware strategy picker.
 *   - withOriginLock           — Per-origin async serialisation guard.
 *   - preconditionsPass        — Pre-flight git checks before `git worktree add`.
 *   - CloneStrategy            — Union type.
 *
 * Concurrency guard: `git worktree add` is NOT safe under concurrent invocation
 * against the same origin. All callers MUST wrap the add + clone block in
 * `withOriginLock(originalRoot, ...)`.
 *
 * Windows: `cloneTree` never calls `execFile('cp', ...)` on Windows — it falls
 * back to Node `fs.promises.cp` which is cross-platform.
 */
import path from 'node:path';
import fs from 'node:fs';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { statfsSync } from 'node:fs';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

import {
  isWindowsPlatform,
  windowsVolumesShareReFS,
} from './platform.js';

const execFile = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CloneStrategy = 'apfs-clonefile' | 'reflink' | 'win-refs' | 'copy';

export interface PreconditionResult {
  ok: boolean;
  reason?: 'empty-origin-repo' | 'branch-already-exists' | 'worktree-already-bound';
  detail?: string;
}

// ---------------------------------------------------------------------------
// Platform-extended statfsSync result type
// ---------------------------------------------------------------------------

/**
 * Node 18.15+ `statfsSync` adds `fstypename` (macOS filesystem name, e.g. 'apfs',
 * 'hfs') and `fsid` ([lo, hi] tuple) on macOS/Linux but `@types/node` only
 * exposes the POSIX-standard numeric fields.  We use this augmented interface
 * for the cast so the compiler accepts the macOS-specific accesses.
 *
 * These fields are runtime-only — the spec intentionally relies on them being
 * present on Node 18.15+ per the §4.14 feature requirements.
 */
interface PlatformStatsFs {
  type: number;
  bsize: number;
  fstypename?: string;
  fsid?: [number, number];
}

// ---------------------------------------------------------------------------
// Per-origin in-process async lock
// ---------------------------------------------------------------------------

const worktreeLocks = new Map<string, Promise<void>>();

/**
 * Serialize async operations on the same `originalRoot` to prevent concurrent
 * `git worktree add` / `git branch` races on `.git/worktrees/` and
 * `.git/refs/heads/task/*`.
 *
 * The key is the realpath-resolved canonical path so symlinks in the
 * caller-supplied path don't produce false parallelism.
 */
export async function withOriginLock<T>(
  originalRoot: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = await realpath(originalRoot);
  const prior = worktreeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  worktreeLocks.set(key, prior.then(() => next));
  await prior;
  try {
    return await fn();
  } finally {
    release();
    if (worktreeLocks.get(key) === next) {
      worktreeLocks.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Filesystem reflink detection (Linux)
// ---------------------------------------------------------------------------

const REFLINK_FILESYSTEMS = new Set(['btrfs', 'xfs', 'zfs']);

/** Injectable statfsSync type (accepts path, returns platform-extended stats). */
export type StatfsSyncFn = (path: string) => PlatformStatsFs;

/** Default statfsSync implementation — wraps Node's built-in. */
const defaultStatfsSync: StatfsSyncFn = (p: string) =>
  statfsSync(p) as unknown as PlatformStatsFs;

/**
 * Returns true only when BOTH `repoRoot` and `worktreeParent` are on the same
 * reflink-capable volume (same fsid + known filesystem type).
 *
 * Cross-volume reflink is rejected by the kernel with EXDEV; falling back to
 * 'copy' is correct in that case.
 */
function filesystemSupportsReflink(
  repoRoot: string,
  worktreeParent: string,
  statfsFn: StatfsSyncFn,
): boolean {
  try {
    const srcFs = statfsFn(repoRoot);
    const dstFs = statfsFn(worktreeParent);
    const srcFsid = srcFs.fsid;
    const dstFsid = dstFs.fsid;
    if (!srcFsid || !dstFsid) return false;
    const sameVolume = srcFsid[0] === dstFsid[0] && srcFsid[1] === dstFsid[1];
    const supported = REFLINK_FILESYSTEMS.has(srcFs.fstypename ?? '');
    return sameVolume && supported;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Clone strategy detection
// ---------------------------------------------------------------------------

/**
 * Determine the best CoW clone strategy for the given (source, destination)
 * volume pair.
 *
 * F20 — must NOT return 'apfs-clonefile' unconditionally on darwin:
 *   - `cp -cR` is a true CoW clone ONLY on APFS volumes that are ALSO the
 *     same volume as the destination.  On HFS+, exFAT, SMB mounts, or
 *     cross-volume pairs it silently performs a full byte-copy, violating the
 *     "disk usage near zero" invariant.
 *   - MUST check: (1) fstypename === 'apfs' AND (2) fsid[0,1] match.
 *
 * F20 Linux: 'reflink' only when same-volume AND filesystem in {btrfs,xfs,zfs}.
 *
 * @param statfsFn — optional injectable statfsSync implementation for testing.
 */
export function detectCloneStrategy(
  repoRoot: string,
  worktreeParent: string,
  statfsFn: StatfsSyncFn = defaultStatfsSync,
): CloneStrategy {
  if (process.platform === 'darwin') {
    try {
      const srcFs = statfsFn(repoRoot);
      const dstFs = statfsFn(worktreeParent);
      const srcFsid = srcFs.fsid;
      const dstFsid = dstFs.fsid;
      const sameApfs =
        srcFs.fstypename === 'apfs' &&
        dstFs.fstypename === 'apfs' &&
        srcFsid !== undefined &&
        dstFsid !== undefined &&
        srcFsid[0] === dstFsid[0] &&
        srcFsid[1] === dstFsid[1];
      if (sameApfs) {
        return 'apfs-clonefile';
      }
    } catch {
      // statfsSync failure (e.g. path doesn't exist yet) → fall back to copy
    }
    return 'copy';
  }

  if (isWindowsPlatform() && windowsVolumesShareReFS(repoRoot, worktreeParent)) {
    return 'win-refs';
  }

  if (process.platform === 'linux' && filesystemSupportsReflink(repoRoot, worktreeParent, statfsFn)) {
    return 'reflink';
  }

  return 'copy';
}

// ---------------------------------------------------------------------------
// Tree clone
// ---------------------------------------------------------------------------

/**
 * Walks `src` recursively and reflinks every file into `dst` using the
 * dynamically-imported `@reflink/reflink` package.
 */
async function reflinkTreeWindows(src: string, dst: string): Promise<void> {
  const mod = await import('@reflink/reflink');
  // Defensive ESM/CJS interop. The package publishes CommonJS
  // (`module.exports = { reflinkFile, reflinkFileSync }`). Modern Node
  // surfaces those at the top level via static analysis, but the
  // version-independent form is `(mod.default ?? mod)`. Do NOT collapse
  // this to `mod.reflinkFileSync` — it ties us to a Node-version
  // assumption that can silently break under different module-resolution
  // modes (notably `verbatimModuleSyntax`/`module: nodenext`).
  const reflinkExports = (mod as { default?: unknown }).default ?? mod;
  const { reflinkFileSync } = reflinkExports as {
    reflinkFileSync: (s: string, d: string) => number;
  };
  await walkAndReflink(src, dst, reflinkFileSync);
}

async function walkAndReflink(
  src: string,
  dst: string,
  reflinkFileSync: (s: string, d: string) => number,
): Promise<void> {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await fs.promises.mkdir(dst, { recursive: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await walkAndReflink(s, d, reflinkFileSync);
    } else if (entry.isFile()) {
      reflinkFileSync(s, d);
    } else if (entry.isSymbolicLink()) {
      const target = await fs.promises.readlink(s);
      await fs.promises.symlink(target, d);
    }
  }
}

function isReflinkRecoverable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as NodeJS.ErrnoException).code;
  const message = (err as Error).message ?? '';
  return (
    code === 'MODULE_NOT_FOUND' ||
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'EXDEV' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    /ERROR_BLOCK_TOO_MANY_REFERENCES/i.test(message) ||
    /cloning is not supported/i.test(message)
  );
}

async function cloneTree(src: string, dst: string, strategy: CloneStrategy): Promise<void> {
  switch (strategy) {
    case 'apfs-clonefile':
      await execFile('cp', ['-cR', src, dst]);
      return;
    case 'reflink':
      await execFile('cp', ['-r', '--reflink=auto', src, dst]);
      return;
    case 'win-refs':
      try {
        await reflinkTreeWindows(src, dst);
        return;
      } catch (err) {
        if (isReflinkRecoverable(err)) {
          await fs.promises.cp(src, dst, { recursive: true, force: true });
          return;
        }
        throw err;
      }
    case 'copy':
      // Node fs.promises.cp is cross-platform (Windows-safe).
      // Never shell out to `cp` on Windows.
      await fs.promises.cp(src, dst, { recursive: true, force: true });
      return;
  }
}

// ---------------------------------------------------------------------------
// Precondition checks
// ---------------------------------------------------------------------------

/**
 * Run pre-flight checks on `originalRoot` before `git worktree add`.
 *
 * Enforced invariants:
 * 1. Repo must have at least one commit (git rev-parse HEAD succeeds).
 * 2. `refs/heads/task/<taskId>` must NOT already exist (signals a prior failed
 *    run that needs operator review — never auto-force or auto-rename).
 * 3. No existing worktree entry already occupies `worktreePath` or the branch.
 *
 * Returns `{ ok: false, reason, detail }` on any violation so the caller can
 * surface a structured activation error.
 */
export async function preconditionsPass(
  originalRoot: string,
  taskId: string,
  worktreePath: string,
): Promise<PreconditionResult> {
  // 1. Check for at least one commit.
  try {
    await execFile('git', ['-C', originalRoot, 'rev-parse', 'HEAD']);
  } catch {
    return {
      ok: false,
      reason: 'empty-origin-repo',
      detail: `git rev-parse HEAD failed in ${originalRoot} — repo has no commits`,
    };
  }

  // 2. Check that refs/heads/task/<taskId> does not already exist.
  const branchRef = `refs/heads/task/${taskId}`;
  try {
    await execFile('git', [
      '-C', originalRoot,
      'rev-parse', '--verify', '--quiet', branchRef,
    ]);
    // Command succeeded → branch exists.
    return {
      ok: false,
      reason: 'branch-already-exists',
      detail: `${branchRef} already exists in ${originalRoot} — prior failed run needs operator review`,
    };
  } catch {
    // Non-zero exit = branch does not exist → expected good path.
  }

  // 3. Check worktree list for path or branch collision.
  let porcelain: string;
  try {
    const { stdout } = await execFile('git', [
      '-C', originalRoot, 'worktree', 'list', '--porcelain',
    ]);
    porcelain = stdout;
  } catch {
    porcelain = '';
  }

  // Git resolves symlinks in worktree paths (macOS /var → /private/var); we must do
  // the same.  Use existsSync-guarded realpath so non-existent paths still compare
  // as their normalized form.
  let resolvedWorktreePath: string;
  try {
    resolvedWorktreePath = existsSync(worktreePath)
      ? fs.realpathSync(worktreePath)
      : path.normalize(worktreePath);
  } catch {
    resolvedWorktreePath = path.normalize(worktreePath);
  }

  for (const block of porcelain.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    const wtPath = lines.find((l) => l.startsWith('worktree '))?.slice('worktree '.length).trim();
    const branch = lines.find((l) => l.startsWith('branch '))?.slice('branch '.length).trim();

    if (wtPath && path.normalize(wtPath) === resolvedWorktreePath) {
      return {
        ok: false,
        reason: 'worktree-already-bound',
        detail: `Worktree path ${worktreePath} is already registered in ${originalRoot}`,
      };
    }
    if (branch === branchRef) {
      return {
        ok: false,
        reason: 'worktree-already-bound',
        detail: `Branch ${branchRef} is already checked out in a worktree of ${originalRoot}`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * CoW-clone every path in `pathsToClone` from `originalRepo` into `worktreeRoot`.
 *
 * - Missing source paths are recorded in `skipped` and do NOT abort materialization.
 * - Strategy is auto-detected per F20 filesystem rules.
 * - Returns { strategy, cloned, skipped } for writing into `.task.json.materialization`.
 */
export async function materializeWorktreeDeps(
  originalRepo: string,
  worktreeRoot: string,
  pathsToClone: string[],
): Promise<{ strategy: CloneStrategy; cloned: string[]; skipped: string[] }> {
  // F20: pass worktree parent dir so detectCloneStrategy can compare fsid for same-volume check.
  const strategy = detectCloneStrategy(originalRepo, path.dirname(worktreeRoot));
  const cloned: string[] = [];
  const skipped: string[] = [];

  for (const rel of pathsToClone) {
    const src = path.join(originalRepo, rel);
    const dst = path.join(worktreeRoot, rel);
    if (!existsSync(src)) {
      skipped.push(rel);
      continue;
    }
    await cloneTree(src, dst, strategy);
    cloned.push(rel);
  }

  return { strategy, cloned, skipped };
}
