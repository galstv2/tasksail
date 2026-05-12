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

import { rebuildAgentMirror } from '../rebuildAgentMirror.js';

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
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001.md', '# History');
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001.md.record.json', '{}');

    const result = await rebuildAgentMirror(repoRoot, contextPackDir);

    expect(result.contextPackName).toBe(packName);
    expect(result.filesCopied).toBe(4);
    expect(result.filesSkipped).toBe(0);
    expect(result.subtreesMissing).toBe(0);

    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.json'))).toBe(true);
    expect(existsSync(mirrorPath('archive/tasks/2026/task-001/archive.md'))).toBe(true);
    expect(existsSync(mirrorPath('retrospectives/history/2026/task-001.md'))).toBe(true);
    expect(existsSync(mirrorPath('retrospectives/history/2026/task-001.md.record.json'))).toBe(true);

    // Content matches canonical.
    expect(readFileSync(mirrorPath('archive/tasks/2026/task-001/archive.json'), 'utf-8'))
      .toBe('{"taskId":"task-001"}');
  });

  it('is idempotent — a second run copies nothing new', async () => {
    const scopeRoot = `qmd/context-packs/${packName}`;
    seedManifest(scopeRoot);
    seedCanonical(scopeRoot, 'archive/tasks/2026/task-001/archive.json', '{"taskId":"task-001"}');
    seedCanonical(scopeRoot, 'retrospectives/history/2026/task-001.md', '# History');

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
