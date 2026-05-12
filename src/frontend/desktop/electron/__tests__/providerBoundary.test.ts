// @vitest-environment node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RoleKind as BackendRoleKind } from '../../../../backend/platform/cli-provider/types.js';
import type { RoleKind as FrontendRoleKind } from '../../src/shared/desktopContractProvider';

const _checkBackendRoleKind: BackendRoleKind = '' as FrontendRoleKind;
const _checkFrontendRoleKind: FrontendRoleKind = '' as BackendRoleKind;
void _checkBackendRoleKind;
void _checkFrontendRoleKind;

const forbiddenTokenSource =
  'Y29waWxvdHxDb3BpbG90fENPUElMT1R8XC5naXRodWJ8Z2l0aHViL2FnZW50c3xnaXRodWIvY29waWxvdHxjaGF0YWdlbnR8Y29waWxvdC1ob21lfENPUElMT1RfSE9NRXxDT1BJTE9UX01PREVMfHBsYW5uaW5nLWFnZW50fHByb2R1Y3QtbWFuYWdlcnxzb2Z0d2FyZS1lbmdpbmVlcnxzb2Z0d2FyZS1lbmdpbmVlci12ZXJpZnk=';

const desktopRoot = path.resolve(__dirname, '..');
const scanRoots = [desktopRoot, path.resolve(desktopRoot, '../src')];
const allowlistPath = path.join(desktopRoot, '__tests__', 'providerBoundary.allowlist.json');
const excludedDirNames = new Set(['node_modules', 'dist', 'dist-electron', 'coverage', '__tests__', 'test']);
const excludedFileSuffixes = ['.test.ts', '.test.tsx', '.test-setup.ts'];

function toPosixRelative(filePath: string): string {
  return path.relative(desktopRoot, filePath).replace(/\\/g, '/');
}

function shouldSkip(filePath: string): boolean {
  const relativePath = toPosixRelative(filePath);
  if (relativePath === '__tests__/providerBoundary.test.ts') {
    return true;
  }
  if (relativePath.startsWith('providers/copilot/')) {
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
    } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !shouldSkip(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('frontend provider boundary', () => {
  it('keeps generic frontend production source provider-neutral', async () => {
    const forbiddenTokens = new RegExp(Buffer.from(forbiddenTokenSource, 'base64').toString('utf-8'), 'u');
    const allowlist = new Set(JSON.parse(await readFile(allowlistPath, 'utf-8')) as string[]);
    const hits: string[] = [];

    for (const root of scanRoots) {
      for (const filePath of await walk(root)) {
        const relativePath = toPosixRelative(filePath);
        if (allowlist.has(relativePath)) {
          continue;
        }
        const content = await readFile(filePath, 'utf-8');
        if (forbiddenTokens.test(content)) {
          hits.push(relativePath);
        }
      }
    }

    expect(hits).toEqual([]);
    expect([...allowlist]).toEqual([]);
  });
});
