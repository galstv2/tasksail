import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  validatePackStructure,
} from '../activate.js';

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>(
    '../../core/index.js',
  );
  return {
    ...actual,
    findRepoRoot: vi.fn(),
    runPython: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  };
});

import { findRepoRoot } from '../../core/index.js';
const mockedFindRepoRoot = vi.mocked(findRepoRoot);

describe('validatePackStructure', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ctx-pack-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a non-existent directory', () => {
    const result = validatePackStructure(path.join(tmpDir, 'does-not-exist'));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not exist');
  });

  it('returns valid=false when no supported inputs exist', () => {
    // Empty directory: no qmd manifest
    const result = validatePackStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('no qmd/repo-sources.json')),
    ).toBe(true);
  });

  it('returns valid=true when qmd manifest is present', () => {
    mkdirSync(path.join(tmpDir, 'qmd'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'qmd', 'repo-sources.json'),
      '{}',
    );
    const result = validatePackStructure(tmpDir);
    expect(result.valid).toBe(true);
  });
});

describe('activateContextPack', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ctx-activate-test-'));
    mockedFindRepoRoot.mockReturnValue(tmpDir);
    // Create .env.example so ensureEnvFile can create .env
    writeFileSync(path.join(tmpDir, '.env.example'), '# defaults\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes ACTIVE_CONTEXT_PACK_DIR to .env on activation', async () => {
    const packDir = path.join(tmpDir, 'my-pack');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), '{}');

    const { activateContextPack } = await import('../activate.js');
    const result = await activateContextPack({ contextPackDir: packDir });

    expect(result.validation.valid).toBe(true);
    expect(result.contextPackDir).toBe(packDir);

    const envContent = readFileSync(path.join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain(`ACTIVE_CONTEXT_PACK_DIR=${packDir}`);
  });

  it('does not write .env on dry run', async () => {
    const packDir = path.join(tmpDir, 'my-pack');
    mkdirSync(path.join(packDir, 'qmd'), { recursive: true });
    writeFileSync(path.join(packDir, 'qmd', 'repo-sources.json'), '{}');

    const { activateContextPack } = await import('../activate.js');
    const result = await activateContextPack({ contextPackDir: packDir, dryRun: true });

    expect(result.validation.valid).toBe(true);

    const envPath = path.join(tmpDir, '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      expect(envContent).not.toContain(`ACTIVE_CONTEXT_PACK_DIR=${packDir}`);
    }
  });
});
