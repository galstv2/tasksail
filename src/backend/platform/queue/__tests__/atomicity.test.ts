import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock node:fs/promises so we can intercept rename calls
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
  };
});

import { rename } from 'node:fs/promises';
import { initializeTaskArtifacts } from '../lifecycle.js';

const mockRename = vi.mocked(rename);

describe('initializeTaskArtifacts rename rollback', () => {
  let tmpDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(path.join(tmpdir(), 'tq-atom-'));
    handoffsDir = path.join(tmpDir, 'handoffs');
    templatesDir = path.join(tmpDir, 'templates');
    mkdirSync(handoffsDir);
    mkdirSync(templatesDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rolls pmck renamed files when a mid-loop rename fails', async () => {
    // Create minimal template files (markdown only — avoids JSON stamping complexity)
    const testFiles = ['file-a.md', 'file-b.md', 'file-c.md'];
    for (const f of testFiles) {
      writeFileSync(
        path.join(templatesDir, f),
        `# ${f}\n<!-- placeholder -->`,
      );
    }

    // Count renames into handoffsDir; fail on the third one
    let handoffRenameCount = 0;
    const { rename: realRename } = await vi.importActual<
      typeof import('node:fs/promises')
    >('node:fs/promises');

    mockRename.mockImplementation(async (src, dest) => {
      const destStr = String(dest);
      if (destStr.startsWith(handoffsDir + path.sep) && !destStr.includes('.staging.')) {
        handoffRenameCount++;
        if (handoffRenameCount > 2) {
          throw new Error('Simulated rename failure');
        }
      }
      return realRename(src, dest);
    });

    await expect(
      initializeTaskArtifacts({
        handoffsDir,
        templatesDir,
        handoffFiles: testFiles,
      }),
    ).rejects.toThrow('Simulated rename failure');

    // handoffsDir should have no handoff files (rollback cleaned them up)
    const remaining = readdirSync(handoffsDir).filter(
      (f) => !f.startsWith('.'),
    );
    expect(remaining).toEqual([]);

    // .publish-in-progress marker should also be cleaned up
    expect(
      existsSync(path.join(handoffsDir, '.publish-in-progress')),
    ).toBe(false);
  });
});
