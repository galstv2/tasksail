import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkOpenSourceReadiness } from '../openSourceReadiness.js';

describe('checkOpenSourceReadiness', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-source-readiness-'));
    writeValidFixtureRepo(repoRoot);
    execFileSync('git', ['init', '-q'], { cwd: repoRoot });
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('passes a release-ready source fixture without a built desktop package', async () => {
    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      'Desktop release directory is absent; packaged-file boundary was checked through build metadata only.',
    );
    expect(result.summary.trackedFiles).toBeGreaterThan(0);
    expect(result.summary.pnpmImporters).toEqual(['.']);
  });

  it('fails missing package license metadata', async () => {
    writeJson('package.json', {
      name: 'tasksail',
      private: true,
      type: 'module',
      scripts: {
        'check-open-source-readiness': 'tsx src/backend/platform/validation/cli.ts check-open-source-readiness',
      },
    });
    gitAddAll();

    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('package.json must declare "license": "MIT".');
  });

  it('fails tracked runtime, generated, and private workstation artifacts', async () => {
    writeFile('.platform-state/runtime/tasks/terminal-events.json', '{}\n');
    writeFile('dist/bundle.js', 'console.log("built");\n');
    writeFile('private-path.txt', '/Users/private-user/Desktop/TaskSail\n');
    gitAddAll();

    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Tracked runtime state is not release-safe: .platform-state/runtime/tasks/terminal-events.json',
      'Tracked generated build output is not release-safe: dist/bundle.js',
      'private-path.txt:1 contains a personal macOS home path.',
    ]));
  });

  it('allows untracked local OS metadata files', async () => {
    writeFile('.DS_Store', 'local\n');

    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails stale pnpm importers unless they have source-owned exceptions', async () => {
    writeFile('pnpm-lock.yaml', [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '  .:',
      '    dependencies: {}',
      '  packages/missing:',
      '    dependencies: {}',
      '',
    ].join('\n'));
    gitAddAll();

    const failing = await checkOpenSourceReadiness({ repoRoot });
    expect(failing.valid).toBe(false);
    expect(failing.errors).toContain(
      'pnpm-lock.yaml importer has no package manifest or documented exception: packages/missing',
    );

    writeJson('src/backend/platform/validation/data/open-source-readiness-exceptions.json', {
      pnpmLockImporterExceptions: [
        {
          importer: 'packages/missing',
          reason: 'Fixture exception for a stale lockfile importer.',
        },
      ],
    });

    const passing = await checkOpenSourceReadiness({ repoRoot });
    expect(passing.valid).toBe(true);
    expect(passing.summary.pnpmImporters).toEqual(['.', 'packages/missing']);
  });

  it('fails packaged desktop output that omits legal files or contains runtime files', async () => {
    writeFile('src/frontend/desktop/release/mac-arm64/TaskSail.app/Contents/Resources/LICENSE', 'MIT License\n');
    writeFile('src/frontend/desktop/release/mac-arm64/TaskSail.app/Contents/Resources/.env', 'SECRET=value\n');

    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'Packaged desktop output is missing THIRD_PARTY_LICENSES.md.',
      'Packaged desktop output is missing OFL-Outfit.txt.',
      'Packaged desktop output is missing OFL-SourceCodePro.txt.',
      'Packaged desktop output contains an env file: mac-arm64/TaskSail.app/Contents/Resources/.env',
    ]));
  });

  it('reports high-confidence secrets without echoing the secret value', async () => {
    writeFile('token.txt', 'OPENAI_API_KEY="sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa"\n');
    gitAddAll();

    const result = await checkOpenSourceReadiness({ repoRoot });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('token.txt:1 contains a high-confidence OpenAI API key.');
    expect(result.errors.join('\n')).not.toContain('sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa');
  });

  function writeValidFixtureRepo(root: string): void {
    writeFileAt(root, 'LICENSE', 'MIT License\n\nCopyright (c) TaskSail contributors\n');
    writeFileAt(root, 'README.md', '# TaskSail\n\nTaskSail is licensed under the MIT License. See LICENSE.\n');
    writeFileAt(root, 'docs/technical/operations/validation-and-exit-codes.md', [
      '# Validation',
      '',
      'Run `pnpm run check-open-source-readiness` before a public MIT source release.',
      '',
    ].join('\n'));
    writeFileAt(root, 'THIRD_PARTY_LICENSES.md', [
      '# Third Party Licenses',
      '',
      'TaskSail uses Electron and React.',
      'Bundled fonts are covered by OFL notices.',
      'development tooling is dev-only and not shipped as runtime code.',
      '',
    ].join('\n'));
    writeJsonAt(root, 'package.json', {
      name: 'tasksail',
      private: true,
      license: 'MIT',
      type: 'module',
      scripts: {
        'check-open-source-readiness': 'tsx src/backend/platform/validation/cli.ts check-open-source-readiness',
      },
    });
    writeJsonAt(root, 'src/frontend/desktop/package.json', {
      name: 'tasksail-desktop',
      private: true,
      license: 'MIT',
      build: {
        extraResources: [
          { from: '../../../LICENSE', to: 'LICENSE' },
          { from: '../../../THIRD_PARTY_LICENSES.md', to: 'THIRD_PARTY_LICENSES.md' },
          { from: 'src/assets/fonts/OFL-Outfit.txt', to: 'licenses/OFL-Outfit.txt' },
          { from: 'src/assets/fonts/OFL-SourceCodePro.txt', to: 'licenses/OFL-SourceCodePro.txt' },
          { from: 'src/assets/fonts/README.md', to: 'licenses/fonts-README.md' },
        ],
        mac: { artifactName: 'tasksail-${version}-${arch}.${ext}' },
        win: { artifactName: 'tasksail-${version}-${arch}.${ext}' },
        linux: { artifactName: 'tasksail-${version}-${arch}.${ext}' },
      },
    });
    writeFileAt(root, 'src/frontend/desktop/src/assets/fonts/Outfit-Regular.woff2', 'font\n');
    writeFileAt(root, 'src/frontend/desktop/src/assets/fonts/SourceCodePro-Regular.woff2', 'font\n');
    writeFileAt(root, 'src/frontend/desktop/src/assets/fonts/OFL-Outfit.txt', 'OFL\n');
    writeFileAt(root, 'src/frontend/desktop/src/assets/fonts/OFL-SourceCodePro.txt', 'OFL\n');
    writeFileAt(root, 'src/frontend/desktop/src/assets/fonts/README.md', 'Font provenance\n');
    writeFileAt(root, 'src/frontend/desktop/build/icon.png', 'png\n');
    writeFileAt(root, 'src/frontend/desktop/build/icon@2x.png', 'png\n');
    writeFileAt(root, 'src/frontend/desktop/build/icon.svg', '<svg />\n');
    writeFileAt(root, 'src/backend/platform/validation/data/open-source-readiness-exceptions.json', JSON.stringify({
      pnpmLockImporterExceptions: [],
    }, null, 2));
    writeFileAt(root, 'pnpm-lock.yaml', [
      "lockfileVersion: '9.0'",
      '',
      'importers:',
      '  .:',
      '    dependencies: {}',
      '',
    ].join('\n'));
  }

  function writeFile(relativePath: string, content: string): void {
    writeFileAt(repoRoot, relativePath, content);
  }

  function writeJson(relativePath: string, content: unknown): void {
    writeJsonAt(repoRoot, relativePath, content);
  }

  function writeFileAt(root: string, relativePath: string, content: string): void {
    const fullPath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  function writeJsonAt(root: string, relativePath: string, content: unknown): void {
    writeFileAt(root, relativePath, `${JSON.stringify(content, null, 2)}\n`);
  }

  function gitAddAll(): void {
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
  }
});
