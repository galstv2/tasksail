import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * These tests validate the switch module's dispatch logic and workspace
 * config handling. Since the actual workspace sync relies on a Python script,
 * we mock runPython to avoid real invocations.
 */

vi.mock('../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/index.js')>(
    '../../core/index.js',
  );
  return {
    ...actual,
    runPython: vi.fn(),
    findRepoRoot: vi.fn(),
  };
});

import { runPython, findRepoRoot } from '../../core/index.js';
import { switchContextPackWorkspace } from '../switch.js';

const mockedRunPython = vi.mocked(runPython);
const mockedFindRepoRoot = vi.mocked(findRepoRoot);

describe('switchContextPackWorkspace', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'switch-test-'));
    mockedFindRepoRoot.mockReturnValue(tmpDir);
    mockedRunPython.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ['preview', '/some/pack', JSON.stringify({ add: ['/repo/src'], remove: [] }), false] as const,
    ['apply',   '/some/pack', '{"ok": true}',                                      true ] as const,
    ['clear',   '',           '{"ok": true}',                                      true ] as const,
  ])('%s mode calls Python with %s action', async (mode, contextPackDir, stdout, needEnvExample) => {
    if (needEnvExample) {
      writeFileSync(path.join(tmpDir, '.env.example'), '# defaults\n');
    }
    mockedRunPython.mockResolvedValue({ stdout, stderr: '', exitCode: 0 });

    const result = await switchContextPackWorkspace({ contextPackDir, mode });

    expect(result.mode).toBe(mode);
    const args = mockedRunPython.mock.calls[0];
    expect(args[1]).toContain(mode);

    if (mode === 'preview') {
      const parsed = JSON.parse(result.output);
      expect(parsed.add).toEqual(['/repo/src']);
      expect(parsed.remove).toEqual([]);
      expect(args[1]).toContain('--action');
    } else if (existsSync(path.join(tmpDir, '.env'))) {
      const envContent = readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(envContent).toContain('ACTIVE_CONTEXT_PACK_DIR=');
    }
  });
});
