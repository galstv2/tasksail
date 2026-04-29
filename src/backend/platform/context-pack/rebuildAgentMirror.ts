/**
 * Rebuild the agent-facing QMD mirror under
 *   AgentWorkSpace/qmd/context-packs/<pack>/
 * from the canonical context-pack archive at
 *   <contextPackDir>/<qmd_scope_root>/
 *
 * Why this exists
 * ───────────────
 * Per the documented storage layout (see CLAUDE.md "Context pack and QMD
 * storage layout"): the canonical QMD lives under `contextpacks/<pack>/`,
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
  readFile,
  mkdir,
  copyFile,
  utimes,
  stat,
} from 'node:fs/promises';

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
): Promise<RebuildAgentMirrorResult> {
  const contextPackName = path.basename(contextPackDir);
  const qmdScopeRoot = await resolveQmdScopeRoot(contextPackDir, contextPackName);

  const canonicalRoot = path.join(contextPackDir, qmdScopeRoot);
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

  for (const subtree of MIRRORED_SUBTREES) {
    const srcRoot = path.join(canonicalRoot, ...subtree);
    const dstRoot = path.join(mirrorRoot, ...subtree);

    if (!existsSync(srcRoot)) {
      subtreesMissing++;
      continue;
    }

    const result = await mirrorTree(srcRoot, dstRoot);
    filesCopied += result.copied;
    filesSkipped += result.skipped;
  }

  return { contextPackName, mirrorRoot, filesCopied, filesSkipped, subtreesMissing };
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
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = JSON.parse(raw) as { qmd_scope_root?: unknown };
    if (typeof parsed.qmd_scope_root === 'string' && parsed.qmd_scope_root.length > 0) {
      return parsed.qmd_scope_root;
    }
  } catch {
    // Manifest missing or unreadable — use the conventional default.
  }
  return path.join('qmd', 'context-packs', packName);
}

async function mirrorTree(
  srcDir: string,
  dstDir: string,
): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      const sub = await mirrorTree(srcPath, dstPath);
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
