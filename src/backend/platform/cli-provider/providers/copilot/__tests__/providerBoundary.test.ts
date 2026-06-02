import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const BACKEND_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const PROVIDER_ROOT = path.resolve(__dirname, '..');
const REGISTRY_COMPOSITION_ROOT = path.join(BACKEND_ROOT, 'platform', 'cli-provider', 'registry.ts');
const DIRECT_COPILOT_REFERENCE_RE = /copilot|Copilot|COPILOT|\.github\/copilot|copilot-home|COPILOT_HOME|COPILOT_MODEL/;

const PRE_EXISTING_COPILOT_AWARE = new Set<string>();

const TEST_FILE_RE = /\.test\.(ts|tsx)$/;

function isUnder(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'dist' || entry === '__tests__' || isUnder(PROVIDER_ROOT, fullPath)) {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    // Test files (including ones that sit next to source rather than inside a __tests__
    // directory) legitimately assert provider literals such as --plugin-dir and
    // COPILOT_SKILLS_DIRS; the boundary guard targets production code only.
    if (stat.isFile() && /\.(ts|py|json)$/.test(entry) && !TEST_FILE_RE.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Copilot provider boundary', () => {
  it('keeps direct Copilot production references inside the provider implementation', () => {
    const offenders = listSourceFiles(BACKEND_ROOT)
      .filter((file) => path.resolve(file) !== REGISTRY_COMPOSITION_ROOT)
      .filter((file) => DIRECT_COPILOT_REFERENCE_RE.test(readFileSync(file, 'utf-8')))
      .map((file) => path.relative(BACKEND_ROOT, file))
      .filter((relative) => !PRE_EXISTING_COPILOT_AWARE.has(relative));

    expect(offenders).toEqual([]);
  });
});
