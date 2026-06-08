import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');

// Pre-refactor mcp root module basenames. Longest variants first so the \b anchor
// distinguishes context_estate_manifest_cli from context_estate_manifest.
const OLD_MODULE_NAMES = [
  'pack_constants', 'pack_io', 'pack_writer', 'pack_preflight',
  'git_roots', 'path_resolution', 'repo_category_probe', 'repo_type_probe',
  'workspace_context_sync_cli', 'workspace_context_sync_deep_focus',
  'workspace_context_sync_resolution', 'workspace_context_sync_service',
  'workspace_context_sync_workspace',
  'context_estate_discovery', 'context_estate_draft_index',
  'context_estate_manifest_cli', 'context_estate_manifest',
  'context_pack_bootstrap',
];
const ALT = OLD_MODULE_NAMES.join('|');
const DOTTED_RE = new RegExp(`\\bsrc\\.backend\\.mcp\\.(${ALT})\\b`);
const SLASH_RE = new RegExp(`src/backend/mcp/(${ALT})\\.py`);
const PKG_ATTR_RE = new RegExp(`from src\\.backend\\.mcp import (${ALT})\\b`);

// Files that legitimately mention the OLD paths (to assert they are gone) - self-exclude.
const ALLOWED_OLD_PATH_REFS = new Set([
  'src/backend/platform/validation/__tests__/mcpReferenceIntegrity.test.ts',
  'tests/domains/test_infra/test_mcp_module_imports.py',
]);

function shouldSkip(relPath: string): boolean {
  return (
    relPath.includes('/dist/') ||
    relPath.includes('/__pycache__/') ||
    relPath.endsWith('.d.ts') ||
    ALLOWED_OLD_PATH_REFS.has(relPath)
  );
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === 'dist') {
          continue;
        }
        await visit(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|py|json)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
}

describe('mcp reference integrity', () => {
  it('has no stale references to pre-refactor mcp root module paths', async () => {
    const roots = ['src', 'tests'].map((r) => path.join(REPO_ROOT, r));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of await listSourceFiles(root)) {
        const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
        if (shouldSkip(relPath)) {
          continue;
        }
        const source = await fs.promises.readFile(file, 'utf-8');
        source.split('\n').forEach((line, i) => {
          if (DOTTED_RE.test(line) || SLASH_RE.test(line) || PKG_ATTR_RE.test(line)) {
            offenders.push(`${relPath}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
