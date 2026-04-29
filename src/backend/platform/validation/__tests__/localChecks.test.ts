import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runLocalChecks } from '../localChecks.js';
import { getRequiredDirs, getRequiredFiles } from '../structure.js';

describe('runLocalChecks', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'local-checks-'));
    await fs.promises.mkdir(path.join(tmpDir, '.git'));

    // Initialize a git repo so git commands work
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns structure failure when dirs are missing', async () => {
    const result = await runLocalChecks({ repoRoot: tmpDir, profile: 'smoke' });
    expect(result.passed).toBe(false);
    const structureCheck = result.results.find(r => r.name === 'structure');
    expect(structureCheck).toBeDefined();
    expect(structureCheck!.passed).toBe(false);
  });

  it('respects profile selection — contracts skips python tests', async () => {
    // Create all required structure
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }
    // Create baseline dir so file size check can find its default path
    await fs.promises.mkdir(path.join(tmpDir, 'packages', 'validation', 'data'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tmpDir, 'packages', 'validation', 'data', 'file-size-baseline.txt'),
      '',
    );

    const result = await runLocalChecks({ repoRoot: tmpDir, profile: 'contracts' });
    const names = result.results.map(r => r.name);
    expect(names).toContain('structure');
    expect(names).toContain('file-sizes');
    // contracts profile should not include python-lint
    expect(names).not.toContain('python-lint');
  });

  it('returns results with duration for each check', async () => {
    const result = await runLocalChecks({ repoRoot: tmpDir, profile: 'smoke' });
    for (const r of result.results) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.passed).toBe('boolean');
      expect(typeof r.duration).toBe('number');
      expect(r.duration).toBeGreaterThanOrEqual(0);
    }
  });

  it('changedPath scopes to desktop-only when path is frontend', async () => {
    const result = await runLocalChecks({
      repoRoot: tmpDir,
      profile: 'full',
      changedPath: 'src/frontend/desktop/src/renderer/App.tsx',
    });
    const names = result.results.map(r => r.name);
    expect(names).toContain('structure');
    expect(names).toContain('file-sizes');
    expect(names).not.toContain('python-lint');
    expect(names).not.toContain('python-tests');
  });

  it('changedPath scopes to python-only when path is backend', async () => {
    const result = await runLocalChecks({
      repoRoot: tmpDir,
      profile: 'full',
      changedPath: 'src/backend/mcp/workspace_context_sync_service.py',
    });
    const names = result.results.map(r => r.name);
    expect(names).toContain('structure');
    expect(names).toContain('file-sizes');
    expect(names).not.toContain('desktop-tests');
    expect(names).not.toContain('desktop-build');
  });
});
