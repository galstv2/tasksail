/**
 * Rebuild the agent-facing QMD mirror under
 *   AgentWorkSpace/qmd/context-packs/<pack>/
 * from the canonical context-pack archive at
 *   <contextPackDir>/<qmd_scope_root>/
 *
 * Why this exists
 * ───────────────
 * The canonical QMD lives under `contextpacks/<pack>/`,
 * and a narrow subset (task archives + global retrospective history) is
 * mirrored into `AgentWorkSpace/qmd/context-packs/<pack>/` so that agents
 * — confined to AgentWorkSpace/ — can read it. The only normal-flow writer
 * of that mirror is `file-task-archive.py::_write_agent_mirrors`, which
 * runs once per task closeout. There is no automatic repair pass: if the
 * mirror is deleted or drifts, nothing rebuilds it until the next task
 * completes.
 *
 * This helper is the explicit repair pass. It is wired into:
 *   - context pack activation (primary trigger; runs on every pack switch)
 *   - reseed (defensive secondary; runs when the operator clicks Reseed)
 *   - the `context-pack rebuild-mirror` CLI command (manual recovery)
 *
 * The sync is one-way: canonical → mirror. Files present in the mirror but
 * absent from canonical are left alone — the canonical tree is the system
 * of record, and we never delete from the mirror to avoid masking bugs.
 *
 * Idempotency: a file is skipped when the mirror already contains a copy
 * of matching size and mtime (mtime is preserved on copy via utimes, so
 * subsequent runs see the same mtime as the canonical source).
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  readdir,
  mkdir,
  copyFile,
  utimes,
  stat,
} from 'node:fs/promises';
import { readTextFile, safeJsonParse } from '../core/index.js';
import {
  assertSnapshotMatchesContextPack,
  loadTaskPackSnapshot,
} from './taskPackSnapshot.js';

export interface RebuildAgentMirrorResult {
  contextPackName: string;
  mirrorRoot: string;
  filesCopied: number;
  filesSkipped: number;
  /**
   * Number of expected canonical subtrees that were missing entirely.
   * Not an error: a freshly seeded pack with no completed tasks will have
   * neither archive/tasks/ nor retrospectives/history/ on disk yet.
   */
  subtreesMissing: number;
}

/**
 * The two subtrees that get mirrored. Mirror surface is intentionally narrow.
 * Adding new entries here MUST be coordinated with file-task-archive.py — the
 * mirror writer of record.
 */
const MIRRORED_SUBTREES: readonly (readonly string[])[] = [
  ['archive', 'tasks'],
  ['retrospectives', 'history'],
];

export async function rebuildAgentMirror(
  repoRoot: string,
  contextPackDir: string,
  options?: { taskId?: string },
): Promise<RebuildAgentMirrorResult> {
  const contextPackName = path.basename(contextPackDir);
  const qmdScopeRoot = options?.taskId
    ? await resolveTaskQmdScopeRoot(repoRoot, contextPackDir, options.taskId)
    : await resolveQmdScopeRoot(contextPackDir, contextPackName);

  const canonicalRoot = path.join(contextPackDir, qmdScopeRoot);
  // Containment guard: a hand-edited/corrupt snapshot or manifest could set a
  // qmd_scope_root like '../../elsewhere' and make the mirror copy from outside
  // the pack. Refuse to traverse outside the context-pack directory.
  const resolvedCanonical = path.resolve(canonicalRoot);
  const resolvedPackDir = path.resolve(contextPackDir);
  if (resolvedCanonical !== resolvedPackDir && !resolvedCanonical.startsWith(resolvedPackDir + path.sep)) {
    throw new Error(
      `qmd_scope_root escapes the context pack directory: ${JSON.stringify(qmdScopeRoot)}`,
    );
  }
  const mirrorRoot = path.join(
    repoRoot,
    'AgentWorkSpace',
    'qmd',
    'context-packs',
    contextPackName,
  );

  let filesCopied = 0;
  let filesSkipped = 0;
  let subtreesMissing = 0;
  // One budget shared across all mirrored subtrees so the entry cap
  // bounds the whole rebuild, not each subtree independently.
  const mirrorBudget = { entries: 0 };

  for (const subtree of MIRRORED_SUBTREES) {
    const srcRoot = path.join(canonicalRoot, ...subtree);
    const dstRoot = path.join(mirrorRoot, ...subtree);

    if (!existsSync(srcRoot)) {
      subtreesMissing++;
      continue;
    }

    const result = await mirrorTree(srcRoot, dstRoot, 0, mirrorBudget);
    filesCopied += result.copied;
    filesSkipped += result.skipped;
  }

  return { contextPackName, mirrorRoot, filesCopied, filesSkipped, subtreesMissing };
}

async function resolveTaskQmdScopeRoot(
  repoRoot: string,
  contextPackDir: string,
  taskId: string,
): Promise<string> {
  const snapshot = await loadTaskPackSnapshot(repoRoot, taskId);
  assertSnapshotMatchesContextPack(snapshot, contextPackDir, repoRoot, taskId);
  return snapshot.qmdScopeRoot;
}

/**
 * Read `qmd_scope_root` from the pack manifest. Falls back to the conventional
 * layout (`qmd/context-packs/<packName>`) when the manifest is missing or the
 * field is absent — that default matches what bootstrap-context-pack writes.
 */
async function resolveQmdScopeRoot(
  contextPackDir: string,
  packName: string,
): Promise<string> {
  const manifestPath = path.join(contextPackDir, 'qmd', 'repo-sources.json');
  const raw = await readTextFile(manifestPath);
  if (raw !== undefined) {
    // A present-but-corrupt manifest surfaces a parse error (vs. the prior bare
    // JSON.parse + swallow, which silently fell back to the default scope root
    // and mirrored from the wrong canonical location).
    const parsed = safeJsonParse<{ qmd_scope_root?: unknown }>(raw, manifestPath);
    if (typeof parsed.qmd_scope_root === 'string' && parsed.qmd_scope_root.length > 0) {
      return parsed.qmd_scope_root;
    }
  }
  return path.join('qmd', 'context-packs', packName);
}

      // Bound the recursive walk so an agent-authored, deeply nested or
// huge subtree under the canonical QMD tree cannot overflow the stack / exhaust
// memory and crash the Node process during context-pack activation. Mutable so
// tests can exercise the caps with small values.
export const MIRROR_WALK_LIMITS = { maxDepth: 200, maxEntries: 50_000 };

export async function mirrorTree(
  srcDir: string,
  dstDir: string,
  depth = 0,
  budget: { entries: number } = { entries: 0 },
): Promise<{ copied: number; skipped: number }> {
  if (depth > MIRROR_WALK_LIMITS.maxDepth) {
    throw new Error(
      `mirrorTree: directory nesting exceeds ${MIRROR_WALK_LIMITS.maxDepth} levels (runaway tree at ${srcDir})`,
    );
  }
  let copied = 0;
  let skipped = 0;
  const entries = await readdir(srcDir, { withFileTypes: true });
  budget.entries += entries.length;
  if (budget.entries > MIRROR_WALK_LIMITS.maxEntries) {
    throw new Error(
      `mirrorTree: entry count exceeds ${MIRROR_WALK_LIMITS.maxEntries} (runaway tree under ${srcDir})`,
    );
  }
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await mirrorTree(srcPath, dstPath, depth + 1, budget);
      copied += sub.copied;
      skipped += sub.skipped;
      continue;
    }
    // Skip symlinks and other non-regular entries — be conservative; the
    // canonical tree is supposed to contain only regular files.
    if (!entry.isFile()) continue;

    if (await mirrorIsCurrent(srcPath, dstPath)) {
      skipped++;
      continue;
    }
    await mkdir(dstDir, { recursive: true });
    await copyFile(srcPath, dstPath);
    // Preserve mtime so the idempotency check works on subsequent runs.
    // Matches the semantics of Python's shutil.copy2 used by the canonical
    // mirror writer in file-task-archive.py.
    const srcStat = await stat(srcPath);
    await utimes(dstPath, srcStat.atime, srcStat.mtime);
    copied++;
  }
  return { copied, skipped };
}

async function mirrorIsCurrent(srcPath: string, dstPath: string): Promise<boolean> {
  if (!existsSync(dstPath)) return false;
  try {
    const [srcStat, dstStat] = await Promise.all([stat(srcPath), stat(dstPath)]);
    if (srcStat.size !== dstStat.size) return false;
    // Allow 1ms tolerance for filesystem mtime resolution differences.
    return Math.abs(srcStat.mtimeMs - dstStat.mtimeMs) <= 1;
  } catch {
    return false;
  }
}
