import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../../core/index.js';
import { runCheck } from '../pythonVersionPolicyCheck.js';

describe('pythonVersionPolicyCheck', () => {
  it('passes on the real repository (3.12 preferred, no stale 3.11/3.13 defaults)', async () => {
    const result = await runCheck(findRepoRoot());
    expect(result.messages).toEqual([]);
    expect(result.ok).toBe(true);
  });

  describe('synthetic violations', () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'pyver-policy-'));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function write(rel: string, content: string): void {
      const target = path.join(dir, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    }

    it('flags a Python 3.11 floor and a missing 3.12 mention in README', async () => {
      write('README.md', 'Requires Python 3.11+.');
      const result = await runCheck(dir);
      expect(result.ok).toBe(false);
      expect(result.messages.join('\n')).toMatch(/README\.md.*3\.11/);
    });

    it('flags a container base image that is not 3.12', async () => {
      write('runtime/docker/repo-context-mcp/Dockerfile', 'FROM python:3.13-alpine\n');
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/Docker base image/);
    });

    it('flags stale Claude Python guidance', async () => {
      write('.claude/CLAUDE.md', '- **Backend:** Python 3.13, http.server, SSE\n');
      const result = await runCheck(dir);
      expect(result.ok).toBe(false);
      expect(result.messages.join('\n')).toMatch(/CLAUDE\.md.*Python 3\.13/);
    });

    it('flags a preflight minimum that is not (3, 12)', async () => {
      write('src/backend/mcp/pack/preflight.py', 'PYTHON_MIN_VERSION: tuple[int, int] = (3, 13)\n');
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/pack_preflight\.py/);
    });

    it('flags a bare python3 invocation in package.json scripts', async () => {
      write('package.json', '{"scripts":{"x":"python3 foo.py"}}');
      const result = await runCheck(dir);
      expect(result.messages.join('\n')).toMatch(/python3 directly/);
    });

    it('passes a clean 3.12 preflight constant', async () => {
      write('src/backend/mcp/pack/preflight.py', 'PYTHON_MIN_VERSION: tuple[int, int] = (3, 12)\n');
      const result = await runCheck(dir);
      expect(result.messages.some((m) => m.includes('pack_preflight'))).toBe(false);
    });
  });
});
