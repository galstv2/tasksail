/**
 * rebuildAgentMirror contract:
 *
 * One-way, partial sync from canonical context-pack archive
 *   <contextPackDir>/<qmd_scope_root>/{archive/tasks,retrospectives/history}/
 * into the agent-facing mirror
 *   <repoRoot>/AgentWorkSpace/qmd/context-packs/<packName>/{archive/tasks,retrospectives/history}/
 *
 * Required behaviors:
 *   1. Copies files that exist canonically and are missing in the mirror.
 *   2. Idempotent — a second call copies nothing new.
 *   3. Reads `qmd_scope_root` from the pack manifest when present.
 *   4. Falls back to the conventional layout when the manifest is missing.
 *   5. Tolerates missing canonical subtrees (fresh pack, no completed tasks).
 *   6. Never deletes from the mirror — files that exist only in the mirror
 *      are left alone (canonical is the system of record, not the source of
 *      a destructive sync).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rebuildAgentMirror, mirrorTree, MIRROR_WALK_LIMITS } from '../rebuildAgentMirror.js';

describe('mirrorTree depth cap (SEC-TS-07)', () => {
  it('throws when directory nesting exceeds the cap', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mirror-cap-'));
    const original = MIRROR_WALK_LIMITS.maxDepth;
    MIRROR_WALK_LIMITS.maxDepth = 3;
    try {
      let p = path.join(tmp, 'src');
      for (let i = 0; i < 6; i += 1) p = path.join(p, `d${i}`);
      mkdirSync(p, { recursive: true });
      writeFileSync(path.join(p, 'leaf.txt'), 'x');
      await expect(
        mirrorTree(path.join(tmp, 'src'), path.join(tmp, 'dst')),
      ).rejects.toThrow(/exceeds 3 levels/);
    } finally {
      MIRROR_WALK_LIMITS.maxDepth = original;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('SEC-TS-07: entry cap is shared across subtree walks (budget threading)', async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'mirror-budget-'));
    const original = MIRROR_WALK_LIMITS.maxEntries;
    MIRROR_WALK_LIMITS.maxEntries = 3;
    try {
      const srcA = path.join(tmp, 'a');
      mkdirSync(srcA, { recursive: true });
      writeFileSync(path.join(srcA, 'f1'), 'x');
      writeFileSync(path.join(srcA, 'f2'), 'x');
      const srcB = path.join(tmp, 'b');
      mkdirSync(srcB, { recursive: true });
      writeFileSync(path.join(srcB, 'f3'), 'x');
      writeFileSync(path.join(srcB, 'f4'), 'x');

      // A single shared budget must carry across both walks: 2 + 2 = 4 > cap of 3.
      const budget = { entries: 0 };
      await mirrorTree(srcA, path.join(tmp, 'dstA'), 0, budget);
      await expect(
        mirrorTree(srcB, path.join(tmp, 'dstB'), 0, budget),
      ).rejects.toThrow(/entry count exceeds 3/);
    } finally {
      MIRROR_WALK_LIMITS.maxEntries = original;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('rebuildAgentMirror', () => {
  let workDir: string;
  let repoRoot: string;
  let contextPackDir: string;
  const packName = 'demo-pack';

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'rebuild-mirror-'));
    repoRoot = path.join(workDir, 'repo');
    contextPackDir = path.join(repoRoot, 'contextpacks', packName);
    mkdirSync(contextPackDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function seedManifest(qmdScopeRoot?: string | null): void {
    const manifestDir = path.join(contextPackDir, 'qmd');
    mkdirSync(manifestDir, { recursive: true });
    const manifest: Record<string, unknown> = {
      manifest_version: 'qmd-repo-sources/v1',
      context_pack_id: packName,
    };
    if (qmdScopeRoot !== null && qmdScopeRoot !== undefined) {
      manifest.qmd_scope_root = qmdScopeRoot;
    }
    writeFileSync(
      path.join(manifestDir, 'repo-sources.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );
  }

  function seedCanonical(scopeRoot: string, relativePath: string, content: string): string {
    const fullPath = path.join(contextPackDir, scopeRoot, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  function mirrorPath(relativePath: string): string {
    return path.join(repoRoot, 'AgentWorkSpace', 'qmd', 'context-packs', packName, relativePath);
  }

  it('copies canonical archive and retrospective history files into the mirror', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"taskId":"task-001"}');
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.md', '# Task 001');
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001/retrospective.md', '# History');
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001/retrospective.md.record.json', '{}');

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.contextPackName).toBe(packName);
    expect(result.filesCopied).toBe(4);
    expect(result.filesSkipped).toBe(0);
    expect(result.subtreesMissing).toBe(0);

    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.json'))).toBe(true);
    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.md'))).toBe(true);
    expect(existsSync(mirrorPath('retrospectives/history/2026/task-001/retrospective.md'))).toBe(true);
    expect(existsSync(mirrorPath('retrospectives/history/2026/task-001/retrospective.md.record.json'))).toBe(true);

    // Content matches canonical.
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/archive.json'), 'utf-8'))
      .toBe('{"taskId":"task-001"}');
  });

  it('repairs archived handoff and implementation-step artifacts in task archive subtrees', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"taskId":"task-001"}');
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/handoffs/intake.md', 'intake');
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/ImplementationSteps/slice-1.md', 'slice');
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/handoff-artifacts-manifest.json', '{"schema_version":"handoff-artifacts/v1"}');

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.filesCopied).toBe(4);
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/handoffs/intake.md'), 'utf-8'))
      .toBe('intake');
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/ImplementationSteps/slice-1.md'), 'utf-8'))
      .toBe('slice');
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/handoff-artifacts-manifest.json'), 'utf-8'))
      .toBe('{"schema_version":"handoff-artifacts/v1"}');
  });

  it('is idempotent — a second run copies nothing new', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"taskId":"task-001"}');
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001/retrospective.md', '# History');

    const first = await rebuildAgentMirror(repoRoot, contextPackDir);
    expect(first.filesCopied).toBe(2);

    const second = await rebuildAgentMirror(repoRoot, contextPackDir);
    expect(second.filesCopied).toBe(0);
    expect(second.filesSkipped).toBe(2);
  });

  it('re-copies a file when canonical has been updated (size or mtime change)', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    const canonicalFile = seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"v":1}');

    await rebuildAgentMirror(repoRoot, contextPackDir);
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/archive.json'), 'utf-8')).toBe('{"v":1}');

    // Update canonical with different content (different size guarantees re-copy).
    writeFileSync(canonicalFile, '{"v":2,"more":"data"}', 'utf-8');

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);
    expect(result.filesCopied).toBe(1);
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/archive.json'), 'utf-8'))
      .toBe('{"v":2,"more":"data"}');
  });

  it('falls back to the conventional layout when the manifest is missing', async () => {
    // No manifest seeded — helper must use `qmd/context-packs/<packName>` default.
    seedCanonical(
      `qmd/context-packs/${packName}`,
      'archive/tasks/2026/task-001/archive.json',
      '{"taskId":"task-001"}',
    );

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.filesCopied).toBe(1);
    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.json'))).toBe(true);
  });

  it('honors a non-default qmd_scope_root from the manifest', async () => {
    const scopeRoot = 'qmd/custom-scope';
    seedManifest(scopeRoot);
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"taskId":"task-001"}');

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.filesCopied).toBe(1);
    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.json'))).toBe(true);
  });

  it('tolerates missing canonical subtrees (fresh pack, no completed tasks)', async () => {
    // Manifest exists but neither archive/tasks nor retrospectives/history are seeded.
    seedManifest(`qmd/context-packs/${packName}`);

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.filesCopied).toBe(0);
    expect(result.filesSkipped).toBe(0);
    expect(result.subtreesMissing).toBe(2);
  });

  it('does NOT delete files that exist only in the mirror (one-way sync)', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    // Canonical contains nothing.

    // Operator-placed file in the mirror that has no canonical counterpart.
    const orphanPath = mirrorPath('archive/tasks/2026/orphan.json');
    mkdirSync(path.dirname(orphanPath), { recursive: true });
    writeFileSync(orphanPath, '{"orphan":true}', 'utf-8');

    await rebuildAgentMirror(repoRoot, contextPackDir);

    // Orphan must still exist — canonical is authoritative for what gets WRITTEN,
    // not for what gets DELETED. Mirror cleanup is intentionally manual.
    expect(existsSync(orphanPath)).toBe(true);
    expect(readFileSync(orphanPath, 'utf-8')).toBe('{"orphan":true}');
  });
});
