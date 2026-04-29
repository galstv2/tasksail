import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  validateStructure,
  GENERIC_REQUIRED_DIRS,
  GENERIC_REQUIRED_FILES,
  getRequiredDirs,
  getRequiredFiles,
} from '../structure.js';

describe('getRequiredDirs contents', () => {
  it('contains AgentWorkSpace/tasks and AgentWorkSpace/error-items', () => {
    expect(GENERIC_REQUIRED_DIRS).toContain('AgentWorkSpace/tasks');
    expect(GENERIC_REQUIRED_DIRS).toContain('AgentWorkSpace/error-items');
  });

  it('does not contain legacy singleton dirs AgentWorkSpace/handoffs or the old hyphen-free error dir', () => {
    expect(GENERIC_REQUIRED_DIRS).not.toContain('AgentWorkSpace/handoffs');
    // error-items (with hyphen) must be present; the old non-hyphenated name must NOT be present.
    const oldErrorDir = ['AgentWorkSpace', 'error' + 'items'].join('/');
    expect(GENERIC_REQUIRED_DIRS).not.toContain(oldErrorDir);
  });

  it('adds active provider required directories at validation time', () => {
    const requiredDirs = getRequiredDirs(process.cwd());
    expect(requiredDirs).toContain('.github/agents');
    expect(requiredDirs).toContain('.github/copilot');
    expect(requiredDirs).toContain('AgentWorkSpace/tasks');
  });
});

describe('getRequiredFiles contents', () => {
  it('platform-generic file list contains the base operator-facing files', () => {
    expect(GENERIC_REQUIRED_FILES).toContain('.env.example');
    expect(GENERIC_REQUIRED_FILES).toContain('Makefile');
  });

  it('getRequiredFiles equals the generic list — the Copilot provider declares no required files', () => {
    // The Copilot CLI's `--agent` mode reads role instructions from
    // .github/copilot/instructions/ (enforced via requiredDirs). There is no
    // top-level file the CLI auto-loads at runtime, so the provider has no
    // required-file contract to add to the generic set.
    //
    // In particular, .github/copilot-instructions.md is GitHub's IDE / Chat
    // convention — a personal dev aid, gitignored in this repo — and must
    // NOT be on the validation gate. If it were, a fresh clone would fail
    // `pnpm run validate` until the developer manually created a personal
    // file the platform never reads at runtime.
    const requiredFiles = getRequiredFiles(process.cwd());
    expect(requiredFiles).toEqual(GENERIC_REQUIRED_FILES);
    expect(requiredFiles).not.toContain('.github/copilot-instructions.md');
    expect(requiredFiles).not.toContain('CLAUDE.md');
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
    for (const file of getRequiredFiles(tmpDir)) {
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
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing required file'))).toBe(true);
  });

  it('passes when all required dirs and files exist', async () => {
    for (const dir of getRequiredDirs(tmpDir)) {
      await fs.promises.mkdir(path.join(tmpDir, dir), { recursive: true });
    }
    for (const file of getRequiredFiles(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, '');
    }

    const result = await validateStructure(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
