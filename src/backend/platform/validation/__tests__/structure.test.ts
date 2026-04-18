import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { validateStructure, REQUIRED_DIRS, REQUIRED_FILES } from '../structure.js';

describe('REQUIRED_DIRS contents', () => {
  it('contains AgentWorkSpace/tasks and AgentWorkSpace/error-items', () => {
    expect(REQUIRED_DIRS).toContain('AgentWorkSpace/tasks');
    expect(REQUIRED_DIRS).toContain('AgentWorkSpace/error-items');
  });

  it('does not contain legacy singleton dirs AgentWorkSpace/handoffs or the old hyphen-free error dir', () => {
    expect(REQUIRED_DIRS).not.toContain('AgentWorkSpace/handoffs');
    // error-items (with hyphen) must be present; the old non-hyphenated name must NOT be present.
    const oldErrorDir = ['AgentWorkSpace', 'error' + 'items'].join('/');
    expect(REQUIRED_DIRS).not.toContain(oldErrorDir);
  });
});

describe('validateStructure', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'validate-structure-'));
    // Create .git so findRepoRoot works if called without repoRoot
    await fs.promises.mkdir(path.join(tmpDir, '.git'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects missing required directories', async () => {
    // Create only files, no dirs
    for (const file of REQUIRED_FILES) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('Missing required directory'))).toBe(true);
  });

  it('detects missing required files', async () => {
    // Create all dirs but no files
    for (const dir of REQUIRED_DIRS) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing required file'))).toBe(true);
  });

  it('passes when all required dirs and files exist', async () => {
    for (const dir of REQUIRED_DIRS) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of REQUIRED_FILES) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
