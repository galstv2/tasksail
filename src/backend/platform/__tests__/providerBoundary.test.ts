import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const platformRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(platformRoot, '..');
const scanRoots = [
  platformRoot,
  path.join(backendRoot, 'scripts', 'python', 'lib'),
];
const excludedDirNames = new Set(['node_modules', 'dist', 'coverage', '__tests__', 'fixtures']);
const excludedFileSuffixes = ['.test.ts', '.test.tsx'];
const providerImplementationRoot = path.join(platformRoot, 'cli-provider', 'providers', 'copilot');
const forbiddenTokens = /Copilot CLI|Copilot-advertised|COPILOT_|\.github\/copilot|github\/agents|github\/copilot|chatagent|copilot-home|COPILOT_HOME|COPILOT_MODEL|readCopilotPluginManifestSummary|AGENT_MODEL_CATALOG_RELATIVE_PATH/u;
const forbiddenProviderImport = /cli-provider\/providers\/copilot/u;

function toPosixRelative(filePath: string): string {
  return path.relative(backendRoot, filePath).replace(/\\/g, '/');
}

function isUnder(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function shouldSkip(filePath: string): boolean {
  if (isUnder(providerImplementationRoot, filePath)) {
    return true;
  }
  const relativePath = toPosixRelative(filePath);
  if (relativePath === 'platform/__tests__/providerBoundary.test.ts') {
    return true;
  }
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
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx|py|json)$/u.test(entry.name) && !shouldSkip(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('backend provider boundary', () => {
  it('keeps generic backend production source provider-neutral', async () => {
    const offenders: string[] = [];

    for (const root of scanRoots) {
      for (const filePath of await walk(root)) {
        const relativePath = toPosixRelative(filePath);
        const content = await readFile(filePath, 'utf-8');
        if (forbiddenTokens.test(content) || forbiddenProviderImport.test(content)) {
          offenders.push(relativePath);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
