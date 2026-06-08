// @vitest-environment node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const forbiddenTokenSource =
  'XGJMaWx5XGJ8XGJBbGljZVxifFxiRGFsdG9uXGJ8XGJSb25cYnxsaWx5UGVyc29uYWxpdHlJZHxQbGFubmVyTGlseXxsaWx5UGxhbm5pbmdSZWxvYWRTY29wZQ==';

const desktopRoot = path.resolve(__dirname, '..');
const scanRoots = [desktopRoot, path.resolve(desktopRoot, '../src')];
const excludedDirNames = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '__tests__', 'test']);
const excludedFileSuffixes = ['.test.ts', '.test.tsx', '.test-setup.ts', '.testSetup.tsx'];
const scannedExtensions = new Set(['.ts', '.tsx', '.css']);

function toPosixRelative(filePath: string): string {
  return path.relative(desktopRoot, filePath).replace(/\\/g, '/');
}

function shouldSkip(filePath: string): boolean {
  const relativePath = toPosixRelative(filePath);
  return excludedFileSuffixes.some((suffix) => relativePath.endsWith(suffix));
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (excludedDirNames.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(entryPath));
    } else if (scannedExtensions.has(path.extname(entry.name)) && !shouldSkip(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('frontend persona boundary', () => {
  it('keeps generic frontend production source role-neutral', async () => {
    const forbiddenTokens = new RegExp(Buffer.from(forbiddenTokenSource, 'base64').toString('utf-8'), 'u');
    const hits: string[] = [];

    for (const root of scanRoots) {
      for (const filePath of await walk(root)) {
        const content = await readFile(filePath, 'utf-8');
        if (forbiddenTokens.test(content)) {
          hits.push(toPosixRelative(filePath));
        }
      }
    }

    expect(hits).toEqual([]);
  });
});
