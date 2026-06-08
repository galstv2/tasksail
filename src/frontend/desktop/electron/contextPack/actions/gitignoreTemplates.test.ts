// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LANGUAGE_CATALOG } from '../../../src/shared/contextPackLanguages';
import {
  _fsOps,
  normalizeGitignoreLanguage,
  renderGitignore,
  resolveGitignoreTemplateKeys,
  writeGitignoreIfMissing,
} from './gitignoreTemplates';
import {
  defaultTemplate,
  csharpTemplate,
  typescriptTemplate,
  javascriptTemplate,
  pythonTemplate,
  javaTemplate,
  goTemplate,
  rustTemplate,
  rubyTemplate,
  sqlTemplate,
  hclTemplate,
  shellTemplate,
  powershellTemplate,
} from './gitignoreTemplates.generated';

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '-b', 'main', dir]);
  await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test']);
}

async function gitCheckIgnore(repoDir: string, path: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', repoDir, 'check-ignore', '--quiet', path]);
    return true;
  } catch {
    return false;
  }
}

async function writeTempGitignore(repoDir: string, content: string): Promise<void> {
  await writeFile(join(repoDir, '.gitignore'), content, 'utf8');
}

function normalizedAssetText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tasksail-gitignore-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  const dirs = [...tempDirs];
  tempDirs = [];
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
});

describe('normalizeGitignoreLanguage — canonical values', () => {
  it.each([
    ['csharp',      'csharp'],
    ['typescript',  'typescript'],
    ['javascript',  'javascript'],
    ['python',      'python'],
    ['java',        'java'],
    ['go',          'go'],
    ['rust',        'rust'],
    ['ruby',        'ruby'],
    ['sql',         'sql'],
    ['hcl',         'hcl'],
    ['shell',       'shell'],
    ['powershell',  'powershell'],
  ] as const)('maps %s directly', (input, expected) => {
    expect(normalizeGitignoreLanguage(input)).toBe(expected);
  });
});

describe('normalizeGitignoreLanguage — aliases', () => {
  it.each([
    ['c#',        'csharp'],
    ['dotnet',    'csharp'],
    ['.net',      'csharp'],
    ['ts',        'typescript'],
    ['tsx',       'typescript'],
    ['js',        'javascript'],
    ['jsx',       'javascript'],
    ['node',      'javascript'],
    ['py',        'python'],
    ['jvm',       'java'],
    ['golang',    'go'],
    ['rs',        'rust'],
    ['rb',        'ruby'],
    ['rails',     'ruby'],
    ['database',  'sql'],
    ['terraform', 'hcl'],
    ['opentofu',  'hcl'],
    ['tf',        'hcl'],
    ['bash',      'shell'],
    ['sh',        'shell'],
    ['zsh',       'shell'],
    ['pwsh',      'powershell'],
    ['ps1',       'powershell'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(normalizeGitignoreLanguage(input)).toBe(expected);
  });
});

describe('normalizeGitignoreLanguage — default-only values', () => {
  it.each([
    ['markdown'],
    ['blank'],
    ['swift'],
    ['yaml'],
    ['json'],
    ['unknown'],
    ['custom'],
  ] as const)('%s -> undefined', (input) => {
    expect(normalizeGitignoreLanguage(input)).toBeUndefined();
  });
});

describe('LANGUAGE_CATALOG coverage', () => {
  it('every selectable language resolves to a known template key', () => {
    for (const entry of LANGUAGE_CATALOG) {
      const key = normalizeGitignoreLanguage(entry.value);
      expect(key, `${entry.value} should resolve to a known key`).not.toBeUndefined();
    }
  });

  it('catalog has exactly the 12 expected values', () => {
    const values = LANGUAGE_CATALOG.map((e) => e.value).sort();
    expect(values).toEqual([
      'csharp', 'go', 'hcl', 'java', 'javascript',
      'powershell', 'python', 'ruby', 'rust', 'shell', 'sql', 'typescript',
    ].sort());
  });
});

// ---------------------------------------------------------------------------
// 5. resolveGitignoreTemplateKeys — stable canonical order
// ---------------------------------------------------------------------------

describe('resolveGitignoreTemplateKeys — canonical order', () => {
  it('returns keys in canonical order regardless of input order', () => {
    const result = resolveGitignoreTemplateKeys(['python', 'typescript', 'go']);
    expect(result).toEqual(['typescript', 'python', 'go']);
  });

  it('deduplicates aliases to the same key', () => {
    const result = resolveGitignoreTemplateKeys(['ts', 'typescript', 'tsx']);
    expect(result).toEqual(['typescript']);
  });

  it('returns empty array for default-only languages', () => {
    expect(resolveGitignoreTemplateKeys(['markdown', 'yaml', 'json'])).toEqual([]);
  });

  it('mixed default-only and real languages keeps only real keys', () => {
    const result = resolveGitignoreTemplateKeys(['markdown', 'python', 'unknown']);
    expect(result).toEqual(['python']);
  });

  it('full 12-language list returns in canonical order', () => {
    const shuffled = [
      'powershell', 'hcl', 'sql', 'ruby', 'rust', 'go',
      'java', 'python', 'javascript', 'typescript', 'csharp', 'shell',
    ];
    const result = resolveGitignoreTemplateKeys(shuffled);
    expect(result).toEqual([
      'csharp', 'typescript', 'javascript', 'python', 'java',
      'go', 'rust', 'ruby', 'sql', 'hcl', 'shell', 'powershell',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. renderGitignore — output structure and formatting
// ---------------------------------------------------------------------------

describe('renderGitignore — output format', () => {
  it('ends with exactly one trailing newline', () => {
    const out = renderGitignore(['python']);
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });

  it('uses LF line endings only', () => {
    const out = renderGitignore(['typescript', 'python']);
    expect(out).not.toContain('\r');
  });

  it('includes generated header', () => {
    const out = renderGitignore([]);
    expect(out).toContain('Generated by TaskSail');
  });

  it('always includes default content', () => {
    const out = renderGitignore([]);
    expect(out).toContain('.env');
    expect(out).toContain('logs/');
  });

  it('includes default content even with languages', () => {
    const out = renderGitignore(['python']);
    expect(out).toContain('.env');
  });

  it('includes language section for python', () => {
    const out = renderGitignore(['python']);
    expect(out).toContain('__pycache__/');
    expect(out).toContain('.venv/');
  });

  it('does not add section for markdown', () => {
    const out = renderGitignore(['markdown']);
    expect(out).not.toContain('node_modules/');
    expect(out).toContain('.env');
  });

  it('renders multiple language sections in canonical order', () => {
    const out = renderGitignore(['go', 'typescript']);
    const tsIdx = out.indexOf('node_modules/');
    const goIdx = out.indexOf('pkg/');
    // typescript (canonical position 2) should appear before go (position 6)
    expect(tsIdx).toBeGreaterThan(-1);
    expect(goIdx).toBeGreaterThan(-1);
    expect(tsIdx).toBeLessThan(goIdx);
  });

  it('default appears exactly once even with multiple languages', () => {
    const out = renderGitignore(['python', 'go']);
    const count = (out.match(/# macOS/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('no http/https URLs in output', () => {
    const all = LANGUAGE_CATALOG.map((e) => e.value);
    const out = renderGitignore(all);
    expect(out).not.toMatch(/https?:\/\//);
  });
});

// ---------------------------------------------------------------------------
// 7. git check-ignore fixtures — default must-ignore
// ---------------------------------------------------------------------------

describe('git check-ignore — default must-ignore', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore([]));
  });

  it('ignores .DS_Store (macOS)', async () => {
    await writeFile(join(repoDir, '.DS_Store'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.DS_Store')).toBe(true);
  });

  it('ignores $RECYCLE.BIN/ (Windows)', async () => {
    await mkdir(join(repoDir, '$RECYCLE.BIN'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, '$RECYCLE.BIN')).toBe(true);
  });

  it('ignores .directory (Linux)', async () => {
    await writeFile(join(repoDir, '.directory'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.directory')).toBe(true);
  });

  it('ignores .env', async () => {
    await writeFile(join(repoDir, '.env'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.env')).toBe(true);
  });

  it('ignores .env.local', async () => {
    await writeFile(join(repoDir, '.env.local'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.env.local')).toBe(true);
  });

  it('preserves .env.example (not ignored)', async () => {
    await writeFile(join(repoDir, '.env.example'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.env.example')).toBe(false);
  });

  it('preserves .env.sample (not ignored)', async () => {
    await writeFile(join(repoDir, '.env.sample'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.env.sample')).toBe(false);
  });

  it('preserves .env.template (not ignored)', async () => {
    await writeFile(join(repoDir, '.env.template'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, '.env.template')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. git check-ignore fixtures — must-NOT-ignore (lockfiles and source files)
// ---------------------------------------------------------------------------

describe('git check-ignore — must not ignore lockfiles', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    // Use TS + JS + Rust + Ruby templates — these cover the lockfiles
    await writeTempGitignore(repoDir, renderGitignore(['typescript', 'javascript', 'rust', 'ruby']));
  });

  it.each([
    ['package-lock.json'],
    ['npm-shrinkwrap.json'],
    ['pnpm-lock.yaml'],
    ['yarn.lock'],
    ['bun.lockb'],
    ['Cargo.lock'],
    ['Gemfile.lock'],
    ['go.sum'],
    ['gradle.lockfile'],
  ] as const)('does not ignore %s', async (lf) => {
    await writeFile(join(repoDir, lf), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, lf)).toBe(false);
  });
});

describe('git check-ignore — must not ignore representative source files', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    const all = LANGUAGE_CATALOG.map((e) => e.value);
    await writeTempGitignore(repoDir, renderGitignore(all));
  });

  it.each([
    ['schema.sql'],
    ['script.ps1'],
    ['deploy.sh'],
    ['app.ts'],
    ['app.py'],
    ['main.go'],
    ['lib.rs'],
    ['app.rb'],
    ['Program.cs'],
    ['main.tf'],
    ['main.hcl'],
    ['README.md'],
  ] as const)('does not ignore %s', async (sf) => {
    await writeFile(join(repoDir, sf), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, sf)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. git check-ignore fixtures — per-language generated-output sentinels
// ---------------------------------------------------------------------------

describe('git check-ignore — TypeScript/JavaScript sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['typescript', 'javascript']));
  });

  it('ignores node_modules/', async () => {
    await mkdir(join(repoDir, 'node_modules'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'node_modules')).toBe(true);
  });

  it('ignores dist/', async () => {
    await mkdir(join(repoDir, 'dist'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'dist')).toBe(true);
  });

  it('ignores coverage/', async () => {
    await mkdir(join(repoDir, 'coverage'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'coverage')).toBe(true);
  });
});

describe('git check-ignore — Python sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['python']));
  });

  it('ignores __pycache__/', async () => {
    await mkdir(join(repoDir, '__pycache__'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, '__pycache__')).toBe(true);
  });

  it('ignores .venv/', async () => {
    await mkdir(join(repoDir, '.venv'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, '.venv')).toBe(true);
  });
});

describe('git check-ignore — Java sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['java']));
  });

  it('ignores target/', async () => {
    await mkdir(join(repoDir, 'target'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'target')).toBe(true);
  });

  it('ignores .gradle/', async () => {
    await mkdir(join(repoDir, '.gradle'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, '.gradle')).toBe(true);
  });

  it('ignores build/', async () => {
    await mkdir(join(repoDir, 'build'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'build')).toBe(true);
  });
});

describe('git check-ignore — C# sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['csharp']));
  });

  it('ignores bin/', async () => {
    await mkdir(join(repoDir, 'bin'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'bin')).toBe(true);
  });

  it('ignores obj/', async () => {
    await mkdir(join(repoDir, 'obj'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'obj')).toBe(true);
  });

  it('ignores TestResults/', async () => {
    await mkdir(join(repoDir, 'TestResults'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'TestResults')).toBe(true);
  });

  it('ignores *.dacpac files', async () => {
    await writeFile(join(repoDir, 'MyDb.dacpac'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, 'MyDb.dacpac')).toBe(true);
  });
});

describe('git check-ignore — HCL/Terraform sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['hcl']));
  });

  it('ignores .terraform/', async () => {
    await mkdir(join(repoDir, '.terraform'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, '.terraform')).toBe(true);
  });

  it('ignores terraform.tfstate', async () => {
    await writeFile(join(repoDir, 'terraform.tfstate'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, 'terraform.tfstate')).toBe(true);
  });

  it('ignores *.tfvars files', async () => {
    await writeFile(join(repoDir, 'secrets.tfvars'), '', 'utf8');
    expect(await gitCheckIgnore(repoDir, 'secrets.tfvars')).toBe(true);
  });
});

describe('git check-ignore — Go sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['go']));
  });

  it('ignores pkg/', async () => {
    await mkdir(join(repoDir, 'pkg'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'pkg')).toBe(true);
  });
});

describe('git check-ignore — Rust sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['rust']));
  });

  it('ignores target/', async () => {
    await mkdir(join(repoDir, 'target'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'target')).toBe(true);
  });
});

describe('git check-ignore — Ruby sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['ruby']));
  });

  it('ignores coverage/', async () => {
    await mkdir(join(repoDir, 'coverage'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'coverage')).toBe(true);
  });

  it('ignores tmp/', async () => {
    await mkdir(join(repoDir, 'tmp'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'tmp')).toBe(true);
  });
});

describe('git check-ignore — PowerShell sentinels', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
    await initGitRepo(repoDir);
    await writeTempGitignore(repoDir, renderGitignore(['powershell']));
  });

  it('ignores TestResults/', async () => {
    await mkdir(join(repoDir, 'TestResults'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'TestResults')).toBe(true);
  });

  it('ignores bin/', async () => {
    await mkdir(join(repoDir, 'bin'), { recursive: true });
    expect(await gitCheckIgnore(repoDir, 'bin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Generated mirror byte-for-byte synchronization
// ---------------------------------------------------------------------------

describe('generated.ts byte-for-byte mirror of .gitignore assets', () => {
  const assetDir = new URL(
    './gitignoreTemplates/',
    import.meta.url,
  ).pathname;

  const pairs: Array<[string, string]> = [
    ['default', defaultTemplate],
    ['csharp', csharpTemplate],
    ['typescript', typescriptTemplate],
    ['javascript', javascriptTemplate],
    ['python', pythonTemplate],
    ['java', javaTemplate],
    ['go', goTemplate],
    ['rust', rustTemplate],
    ['ruby', rubyTemplate],
    ['sql', sqlTemplate],
    ['hcl', hclTemplate],
    ['shell', shellTemplate],
    ['powershell', powershellTemplate],
  ];

  for (const [name, generated] of pairs) {
    it(`${name}.gitignore matches generated string`, async () => {
      const assetBytes = await readFile(join(assetDir, `${name}.gitignore`), 'utf8');
      expect(normalizedAssetText(generated)).toBe(normalizedAssetText(assetBytes));
    });
  }

  it('no missing or extra template keys in generated.ts', () => {
    const expected = [
      'default', 'csharp', 'typescript', 'javascript', 'python',
      'java', 'go', 'rust', 'ruby', 'sql', 'hcl', 'shell', 'powershell',
    ].sort();
    const actual = pairs.map(([name]) => name).sort();
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// 11. writeGitignoreIfMissing — writer behavior
// ---------------------------------------------------------------------------

describe('writeGitignoreIfMissing', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await makeTempDir();
  });

  it('creates .gitignore with rendered content', async () => {
    const result = await writeGitignoreIfMissing(repoDir, ['python']);
    expect(result).toBe('created');
    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content).toContain('.env');
    expect(content).toContain('__pycache__/');
  });

  it('returns exists when .gitignore already exists, preserving content byte-for-byte', async () => {
    const original = '# my custom gitignore\n*.secret\n';
    await writeFile(join(repoDir, '.gitignore'), original, 'utf8');
    const result = await writeGitignoreIfMissing(repoDir, ['python']);
    expect(result).toBe('exists');
    const after = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(after).toBe(original);
  });

  it('concurrent EEXIST path preserves competing content', async () => {
    // Deterministic race: spy _fsOps.open so that immediately before the real
    // exclusive open runs, a competitor writes the .gitignore — making the real
    // open(path, 'wx') fail with EEXIST. This proves the writer never clobbers a
    // file that appears between its decision and its open; a pre-existing-file
    // check alone is insufficient per guard exclusive-race-proof.
    const competing = '# written by another process\n*.tmp\n';
    const gitignorePath = join(repoDir, '.gitignore');
    const realOpen = _fsOps.open.bind(_fsOps);
    vi.spyOn(_fsOps, 'open').mockImplementationOnce(async (p, flag) => {
      if (typeof p === 'string' && p.endsWith('.gitignore') && flag === 'wx') {
        await writeFile(p, competing, 'utf8');
      }
      return realOpen(p as Parameters<typeof realOpen>[0], flag as Parameters<typeof realOpen>[1]);
    });

    const result = await writeGitignoreIfMissing(repoDir, ['go']);
    expect(result).toBe('exists');
    expect(await readFile(gitignorePath, 'utf8')).toBe(competing);
  });

  it('uses no shell execution, no existing-file merge, and no template-path argument', async () => {
    // Inspect the implementation source directly rather than asserting a placeholder.
    const src = await readFile(`${__dirname}/gitignoreTemplates.ts`, 'utf8');
    for (const forbidden of [
      'child_process',
      'execFile',
      'execSync',
      'spawn',
      'cu' + 'rl',
      'wg' + 'et',
      'rename(',
      'appendFile',
      'truncate',
    ]) {
      expect(src).not.toContain(forbidden);
    }
    // Reading an existing .gitignore would violate create-only semantics.
    expect(src).not.toMatch(/readFile\([^)]*\.gitignore/);
    // Public writer arity is exactly (repoDir, languages) — no options/template-path arg.
    expect(writeGitignoreIfMissing.length).toBe(2);
  });

  it('content ends with exactly one trailing newline', async () => {
    await writeGitignoreIfMissing(repoDir, ['go', 'rust']);
    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content.endsWith('\n\n')).toBe(false);
  });

  it('content uses LF line endings', async () => {
    await writeGitignoreIfMissing(repoDir, ['typescript']);
    const content = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(content).not.toContain('\r');
  });

  it('write failure after exclusive create propagates and attempts bounded cleanup', async () => {
    // Inject a fake open that returns a handle whose writeFile throws.
    // The handle's stat() returns a fixed ino/dev so the cleanup identity
    // check passes, and the real unlink removes the file.
    const writeErr = new Error('simulated write failure');
    const fakeHandleStat = { ino: 99999, dev: 88888 } as import('node:fs').Stats;

    // We need a real file path to test cleanup — create the directory but not the file.
    const gitignorePath = join(repoDir, '.gitignore');

    // Spy on _fsOps.open to return a mock handle.
    vi.spyOn(_fsOps, 'open').mockResolvedValueOnce({
      writeFile: vi.fn().mockRejectedValueOnce(writeErr),
      close: vi.fn().mockResolvedValueOnce(undefined),
      stat: vi.fn().mockResolvedValueOnce(fakeHandleStat),
    } as unknown as Awaited<ReturnType<typeof _fsOps.open>>);

    // Spy on _fsOps.stat (path stat) to return the same ino/dev → identity matches.
    vi.spyOn(_fsOps, 'stat').mockResolvedValueOnce(fakeHandleStat);

    // Spy on _fsOps.unlink to verify cleanup was attempted.
    const unlinkSpy = vi.spyOn(_fsOps, 'unlink').mockResolvedValueOnce(undefined);

    await expect(writeGitignoreIfMissing(repoDir, ['python'])).rejects.toThrow('simulated write failure');
    expect(unlinkSpy).toHaveBeenCalledWith(gitignorePath);
  });

  it('cleanup does not unlink when file identity no longer matches', async () => {
    // Same as above, but handle stat and path stat return different inodes →
    // identity mismatch → cleanup skipped → error still propagates.
    const writeErr = new Error('simulated write failure — identity mismatch');
    const handleStat = { ino: 111, dev: 1 } as import('node:fs').Stats;
    const pathStat   = { ino: 222, dev: 1 } as import('node:fs').Stats; // different ino

    vi.spyOn(_fsOps, 'open').mockResolvedValueOnce({
      writeFile: vi.fn().mockRejectedValueOnce(writeErr),
      close: vi.fn().mockResolvedValueOnce(undefined),
      stat: vi.fn().mockResolvedValueOnce(handleStat),
    } as unknown as Awaited<ReturnType<typeof _fsOps.open>>);

    vi.spyOn(_fsOps, 'stat').mockResolvedValueOnce(pathStat);

    const unlinkSpy = vi.spyOn(_fsOps, 'unlink').mockResolvedValueOnce(undefined);

    await expect(writeGitignoreIfMissing(repoDir, ['go'])).rejects.toThrow(
      'simulated write failure — identity mismatch',
    );
    // Identity mismatch: unlink must NOT have been called.
    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('close failure after successful write propagates and attempts bounded cleanup', async () => {
    // writeFile succeeds but close() rejects — a real persistence failure mode on
    // buffered/network filesystems. The writer must NOT return 'created'; it must
    // reject and clean up the file it created when identity still matches.
    const closeErr = new Error('simulated close failure');
    const fakeHandleStat = { ino: 77777, dev: 66666 } as import('node:fs').Stats;
    const gitignorePath = join(repoDir, '.gitignore');

    vi.spyOn(_fsOps, 'open').mockResolvedValueOnce({
      writeFile: vi.fn().mockResolvedValueOnce(undefined),
      close: vi.fn().mockRejectedValueOnce(closeErr),
      stat: vi.fn().mockResolvedValueOnce(fakeHandleStat),
    } as unknown as Awaited<ReturnType<typeof _fsOps.open>>);
    vi.spyOn(_fsOps, 'stat').mockResolvedValueOnce(fakeHandleStat);
    const unlinkSpy = vi.spyOn(_fsOps, 'unlink').mockResolvedValueOnce(undefined);

    await expect(writeGitignoreIfMissing(repoDir, ['python'])).rejects.toThrow('simulated close failure');
    expect(unlinkSpy).toHaveBeenCalledWith(gitignorePath);
  });

  it('close failure does not unlink when file identity no longer matches', async () => {
    const closeErr = new Error('simulated close failure — identity mismatch');
    const handleStat = { ino: 333, dev: 1 } as import('node:fs').Stats;
    const pathStat = { ino: 444, dev: 1 } as import('node:fs').Stats; // replaced file

    vi.spyOn(_fsOps, 'open').mockResolvedValueOnce({
      writeFile: vi.fn().mockResolvedValueOnce(undefined),
      close: vi.fn().mockRejectedValueOnce(closeErr),
      stat: vi.fn().mockResolvedValueOnce(handleStat),
    } as unknown as Awaited<ReturnType<typeof _fsOps.open>>);
    vi.spyOn(_fsOps, 'stat').mockResolvedValueOnce(pathStat);
    const unlinkSpy = vi.spyOn(_fsOps, 'unlink').mockResolvedValueOnce(undefined);

    await expect(writeGitignoreIfMissing(repoDir, ['go'])).rejects.toThrow('identity mismatch');
    expect(unlinkSpy).not.toHaveBeenCalled();
  });
});
