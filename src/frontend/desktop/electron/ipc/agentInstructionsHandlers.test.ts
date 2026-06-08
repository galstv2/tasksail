// @vitest-environment node

import fs, { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
} from './agentInstructionsHandlers';

// Stub the provider so directory maps use predictable relative paths.
vi.mock('../../../../backend/platform/cli-provider/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../backend/platform/cli-provider/index.js')>();
  return {
    ...actual,
    getActiveProvider: (_repoRoot: string) => ({
      agentConfigPaths: () => ({
        root: '.provider',
        profiles: '.provider/agents',
        instructions: '.provider/instructions',
        prompts: '.provider/prompts',
        registry: '.provider/agents/registry.json',
      }),
    }),
  };
});

let tmpDir: string;
let repoRoot: string;
const INSTR_DIR = '.provider/instructions';

function makeFile(relPath: string, content = '# Hello'): string {
  const full = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  return full;
}

function listRequest(directory: 'instructions' | 'profiles' | 'prompts' | 'templates' = 'instructions') {
  return { action: 'agentInstructions.listFiles' as const, payload: { directory } };
}

function readRequest(relativePath: string) {
  return { action: 'agentInstructions.readFile' as const, payload: { relativePath } };
}

function writeRequest(relativePath: string, content = '# Updated') {
  return { action: 'agentInstructions.writeFile' as const, payload: { relativePath, content } };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-handlers-'));
  repoRoot = path.join(tmpDir, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('agentInstructionsHandlers — normal .md files', () => {
  it('list returns sorted regular .md files', async () => {
    makeFile(`${INSTR_DIR}/b.md`, '# B');
    makeFile(`${INSTR_DIR}/a.md`, '# A');

    const result = await listInstructionFiles(listRequest(), { repoRoot });

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'agentInstructions.listFiles') {
      throw new Error('unexpected result');
    }
    expect(result.response.files.map((f) => f.fileName)).toEqual(['a.md', 'b.md']);
  });

  it('read returns file content for a regular .md', async () => {
    makeFile(`${INSTR_DIR}/global.instructions.md`, '# Instructions');

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/global.instructions.md`),
      { repoRoot },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'agentInstructions.readFile') {
      throw new Error('unexpected result');
    }
    expect(result.response.content).toBe('# Instructions');
    expect(result.response.fileName).toBe('global.instructions.md');
  });

  it('write saves content atomically and read reflects the change', async () => {
    makeFile(`${INSTR_DIR}/editable.md`, '# Old');

    const writeResult = await writeInstructionFile(
      writeRequest(`${INSTR_DIR}/editable.md`, '# New'),
      { repoRoot },
    );
    expect(writeResult.ok).toBe(true);

    const readResult = await readInstructionFile(
      readRequest(`${INSTR_DIR}/editable.md`),
      { repoRoot },
    );
    expect(readResult.ok).toBe(true);
    if (!readResult.ok || readResult.response.action !== 'agentInstructions.readFile') {
      throw new Error('unexpected result');
    }
    expect(readResult.response.content).toBe('# New');
  });
});

describe('agentInstructionsHandlers — traversal + non-.md', () => {
  it('rejects ".." in relative path', async () => {
    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/../secret.md`),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects non-.md paths', async () => {
    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/file.txt`),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects paths not under any allowed directory', async () => {
    const result = await readInstructionFile(
      readRequest('unrecognised/file.md'),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });
});

describe('agentInstructionsHandlers — symlinked .md entry', () => {
  it('symlinked .md is omitted from listing', async () => {
    const real = makeFile(`${INSTR_DIR}/real.md`, '# Real');
    fs.symlinkSync(real, path.join(repoRoot, INSTR_DIR, 'linked.md'));

    const result = await listInstructionFiles(listRequest(), { repoRoot });

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'agentInstructions.listFiles') {
      throw new Error('unexpected result');
    }
    const names = result.response.files.map((f) => f.fileName);
    expect(names).toContain('real.md');
    expect(names).not.toContain('linked.md');
  });

  it('symlinked .md is rejected on read', async () => {
    const real = makeFile(`${INSTR_DIR}/real.md`, '# Real');
    // Add a real file to pass the allowlist, then replace with symlink.
    const linkedPath = path.join(repoRoot, INSTR_DIR, 'real.md');
    fs.unlinkSync(linkedPath);
    fs.symlinkSync(real, linkedPath);

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/real.md`),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });

  it('symlinked .md is rejected on write', async () => {
    // Create a file outside repo to be the symlink target
    const outside = path.join(tmpDir, 'outside.md');
    fs.writeFileSync(outside, '# Outside', 'utf-8');
    makeFile(`${INSTR_DIR}/target.md`, '# Orig');
    const linkedPath = path.join(repoRoot, INSTR_DIR, 'target.md');
    fs.unlinkSync(linkedPath);
    fs.symlinkSync(outside, linkedPath);

    const result = await writeInstructionFile(
      writeRequest(`${INSTR_DIR}/target.md`),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });
});

describe('agentInstructionsHandlers — symlinked directory', () => {
  it('list returns empty when instruction directory is a symlink', async () => {
    // Create a real instruction directory elsewhere, then replace it with a symlink.
    const realDir = path.join(tmpDir, 'real-instr-dir');
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'note.md'), '# Note', 'utf-8');

    const instrDir = path.join(repoRoot, INSTR_DIR);
    fs.mkdirSync(path.dirname(instrDir), { recursive: true });
    if (fs.existsSync(instrDir)) {
      fs.rmSync(instrDir, { recursive: true, force: true });
    }
    fs.symlinkSync(realDir, instrDir);

    const result = await listInstructionFiles(listRequest(), { repoRoot });

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'agentInstructions.listFiles') {
      throw new Error('unexpected result');
    }
    expect(result.response.files).toEqual([]);
  });

  it('read fails closed when instruction directory is a symlink', async () => {
    const realDir = path.join(tmpDir, 'real-instr-dir2');
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'note.md'), '# Note', 'utf-8');

    const instrDir = path.join(repoRoot, INSTR_DIR);
    fs.mkdirSync(path.dirname(instrDir), { recursive: true });
    if (fs.existsSync(instrDir)) {
      fs.rmSync(instrDir, { recursive: true, force: true });
    }
    fs.symlinkSync(realDir, instrDir);

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/note.md`),
      { repoRoot },
    );
    expect(result.ok).toBe(false);
  });
});

describe('agentInstructionsHandlers — file swap / identity check', () => {
  it('fails closed when opened handle inode does not match pre-open lstat (POSIX O_NOFOLLOW branch)', async () => {
    // Two real files: the allowlisted one and a decoy.
    const targetFull = makeFile(`${INSTR_DIR}/target.md`, '# Target');
    const decoyFull = makeFile(`${INSTR_DIR}/decoy.md`, '# Decoy');

    // We let lstat pass normally for the allowlist check, but override open()
    // to return a handle pointing at a different inode (the decoy file).
    const { lstat: realLstat } = await import('node:fs/promises');

    const fakeOpen: typeof import('node:fs/promises').open = async (filePath, _flags) => {
      void filePath;
      // Open the decoy — different inode than targetFull.
      return open(decoyFull, fsConstants.O_RDONLY);
    };

    // Build a minimal adapter that uses real lstat but fake open.
    const fsAdapter = {
      readTextFile: (fp: string) => fs.promises.readFile(fp, 'utf-8'),
      writeTextFile: (fp: string, c: string) => fs.promises.writeFile(fp, c, 'utf-8'),
      rename: (s: string, d: string) => fs.promises.rename(s, d),
      readDir: (dp: string, opts: { withFileTypes: true }) =>
        fs.promises.readdir(dp, opts) as Promise<fs.Dirent[]>,
      lstat: (fp: string) => realLstat(fp),
      open: fakeOpen,
      realpath: (fp: string) => fs.promises.realpath(fp),
    };

    // Ensure the allowlisted target is a real regular file for enumeration.
    void targetFull;

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/target.md`),
      { repoRoot, fsAdapter },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/changed while opening/i);
    }
  });

  it('fails closed when handle.stat() reports dev=0/ino=0 (identity cannot be established)', async () => {
    makeFile(`${INSTR_DIR}/stable.md`, '# Stable');

    const { lstat: realLstat } = await import('node:fs/promises');
    const stableFull = path.join(repoRoot, `${INSTR_DIR}/stable.md`);

    // lstat returns genuine stat so allowlist check passes.
    // The fake handle returns zeroed dev/ino so identityMatches returns false.
    const fsAdapter = {
      readTextFile: (fp: string) => fs.promises.readFile(fp, 'utf-8'),
      writeTextFile: (fp: string, c: string) => fs.promises.writeFile(fp, c, 'utf-8'),
      rename: (s: string, d: string) => fs.promises.rename(s, d),
      readDir: (dp: string, opts: { withFileTypes: true }) =>
        fs.promises.readdir(dp, opts) as Promise<fs.Dirent[]>,
      lstat: (fp: string) => realLstat(fp),
      open: async (_fp: string, _flags: number) => ({
        fd: 999999,
        stat: async () => ({
          dev: 0,
          ino: 0,
          size: 64,
          mtimeMs: Date.now(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false,
        } as unknown as fs.Stats),
        close: async () => undefined,
      } as unknown as fs.promises.FileHandle),
      realpath: (fp: string) => fs.promises.realpath(fp),
    };

    void stableFull;

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/stable.md`),
      { repoRoot, fsAdapter },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/changed while opening/i);
    }
  });

  it('reads from the identity-verified handle, not a path re-open (post-check swap yields fd content)', async () => {
    // The genuine allowlisted file; the opened fd holds its bytes.
    makeFile(`${INSTR_DIR}/fdread.md`, '# Genuine');

    const { lstat: realLstat, open: realOpen } = await import('node:fs/promises');

    // Simulate a TOCTOU symlink swap that lands AFTER the post-open identity check:
    // a PATH-based re-open (readTextFile) would now return attacker content, but the
    // handler must read from the already-verified descriptor and yield the genuine bytes.
    const fsAdapter = {
      readTextFile: async (_fp: string) => '# ATTACKER-SWAPPED',
      writeTextFile: (fp: string, c: string) => fs.promises.writeFile(fp, c, 'utf-8'),
      rename: (s: string, d: string) => fs.promises.rename(s, d),
      readDir: (dp: string, opts: { withFileTypes: true }) =>
        fs.promises.readdir(dp, opts) as Promise<fs.Dirent[]>,
      lstat: (fp: string) => realLstat(fp),
      open: (fp: string, flags: number) => realOpen(fp, flags),
      realpath: (fp: string) => fs.promises.realpath(fp),
    };

    const result = await readInstructionFile(
      readRequest(`${INSTR_DIR}/fdread.md`),
      { repoRoot, fsAdapter },
    );

    expect(result.ok).toBe(true);
    if (!result.ok || result.response.action !== 'agentInstructions.readFile') {
      throw new Error('unexpected result');
    }
    // The fd-based read wins: genuine content, never the path-based attacker content.
    expect(result.response.content).toBe('# Genuine');
    expect(result.response.content).not.toContain('ATTACKER');
  });

  it('write fails closed if a symlink is pre-planted at the predicted temp path (no follow, no escape)', async () => {
    makeFile(`${INSTR_DIR}/wtarget.md`, '# Orig');

    // A file outside the validated directory the attacker hopes to redirect the write into.
    const outside = path.join(tmpDir, 'wescape.md');
    fs.writeFileSync(outside, '# UNTOUCHED', 'utf-8');

    // Predict the temp name (pid + injected clock) and pre-plant it as a symlink to `outside`.
    const fixedNow = 1234567890;
    const absolutePath = path.join(repoRoot, `${INSTR_DIR}/wtarget.md`);
    const tempPath = `${absolutePath}.tmp-${process.pid}-${fixedNow}`;
    fs.symlinkSync(outside, tempPath);

    const result = await writeInstructionFile(
      writeRequest(`${INSTR_DIR}/wtarget.md`, '# ATTACKER WRITE'),
      { repoRoot, now: () => fixedNow },
    );

    expect(result.ok).toBe(false);
    // The off-directory symlink target must NOT have been written through.
    expect(fs.readFileSync(outside, 'utf-8')).toBe('# UNTOUCHED');
  });
});
