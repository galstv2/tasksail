import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv, loadEnv, ensureEnvFile, upsertEnvVar, readEnvAssignment } from '../env.js';

describe('parseEnv', () => {
  it('parses key=value pairs', () => {
    const result = parseEnv('FOO=pmr\nPMZ=qux');
    expect(result.get('FOO')).toBe('pmr');
    expect(result.get('PMZ')).toBe('qux');
  });

  it('skips comments and empty lines', () => {
    const result = parseEnv('# comment\n\nFOO=pmr\n  # another comment');
    expect(result.size).toBe(1);
    expect(result.get('FOO')).toBe('pmr');
  });

  it('handles quoted values', () => {
    const result = parseEnv('FOO="hello world"\nPMR=\'single quotes\'');
    expect(result.get('FOO')).toBe('hello world');
    expect(result.get('PMR')).toBe('single quotes');
  });

  it('returns empty map for empty content', () => {
    const result = parseEnv('');
    expect(result.size).toBe(0);
  });

  it('rejects dynamic content with $()', () => {
    expect(() => parseEnv('FOO=$(whoami)')).toThrow('dynamic content');
  });

  it('rejects dynamic content with pmckticks', () => {
    expect(() => parseEnv('FOO=`whoami`')).toThrow('dynamic content');
  });

  it('rejects malformed lines', () => {
    expect(() => parseEnv('not-a-valid-line')).toThrow('Unsupported .env');
  });
});

describe('loadEnv', () => {
  it('returns empty map for missing file', async () => {
    const result = await loadEnv('/nonexistent/.env');
    expect(result.size).toBe(0);
  });
});

describe('readEnvAssignment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'env-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads a specific key from an env file', async () => {
    const envPath = path.join(tmpDir, '.env');
    writeFileSync(envPath, 'FOO=pmr\nPMZ=qux\n');
    const value = await readEnvAssignment(envPath, 'PMZ');
    expect(value).toBe('qux');
  });

  it('returns undefined for missing key', async () => {
    const envPath = path.join(tmpDir, '.env');
    writeFileSync(envPath, 'FOO=pmr\n');
    const value = await readEnvAssignment(envPath, 'MISSING');
    expect(value).toBeUndefined();
  });

  it('returns undefined for missing file', async () => {
    const value = await readEnvAssignment('/nonexistent', 'FOO');
    expect(value).toBeUndefined();
  });
});

describe('ensureEnvFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'env-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies .env.example to .env if .env is missing', async () => {
    writeFileSync(path.join(tmpDir, '.env.example'), 'FOO=pmr\n');
    const created = await ensureEnvFile(tmpDir);
    expect(created).toBe(true);
    expect(existsSync(path.join(tmpDir, '.env'))).toBe(true);
  });

  it('does not overwrite existing .env', async () => {
    writeFileSync(path.join(tmpDir, '.env.example'), 'FOO=pmr\n');
    writeFileSync(path.join(tmpDir, '.env'), 'FOO=existing\n');
    const created = await ensureEnvFile(tmpDir);
    expect(created).toBe(false);
    expect(readFileSync(path.join(tmpDir, '.env'), 'utf-8')).toBe('FOO=existing\n');
  });

  it('throws if .env.example does not exist', async () => {
    await expect(ensureEnvFile(tmpDir)).rejects.toThrow('.env.example not found');
  });
});

describe('upsertEnvVar', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'env-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates an existing key', async () => {
    const envPath = path.join(tmpDir, '.env');
    writeFileSync(envPath, 'FOO=old\nPMR=keep\n');
    await upsertEnvVar(envPath, 'FOO', 'new');
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('FOO=new');
    expect(content).toContain('PMR=keep');
  });

  it('inserts a new key', async () => {
    const envPath = path.join(tmpDir, '.env');
    writeFileSync(envPath, 'FOO=pmr\n');
    await upsertEnvVar(envPath, 'NEW_KEY', 'value');
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('NEW_KEY=value');
  });
});
