import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI_PROVIDER_ROOT = path.resolve(__dirname, '..');
const forbiddenTokenSource =
  'XGJMaWx5XGJ8XGJBbGljZVxifFxiRGFsdG9uXGJ8XGJSb25cYnxsaWx5UGVyc29uYWxpdHlJZHxQbGFubmVyTGlseXxsaWx5UGxhbm5pbmdSZWxvYWRTY29wZQ==';
const excludedDirNames = new Set(['__tests__', 'dist', 'node_modules', 'providers']);
const excludedFileRe = /\.test\.(ts|tsx)$/;

function listSharedSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (excludedDirNames.has(entry)) {
        continue;
      }
      files.push(...listSharedSourceFiles(fullPath));
      continue;
    }
    if (stat.isFile() && entry.endsWith('.ts') && !excludedFileRe.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('CLI provider shared SPI boundary', () => {
  it('keeps shared provider source role-neutral', () => {
    const forbiddenTokens = new RegExp(Buffer.from(forbiddenTokenSource, 'base64').toString('utf-8'), 'u');
    const offenders = listSharedSourceFiles(CLI_PROVIDER_ROOT)
      .filter((file) => forbiddenTokens.test(readFileSync(file, 'utf-8')))
      .map((file) => path.relative(CLI_PROVIDER_ROOT, file).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });
});
