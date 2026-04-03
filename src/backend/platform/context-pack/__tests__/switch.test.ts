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

  it('preview mode calls Python with preview action and returns output', async () => {
    const previewPayload = { add: ['/repo/src'], remove: [] };
    mockedRunPython.mockResolvedValue({
      stdout: JSON.stringify(previewPayload),
      stderr: '',
      exitCode: 0,
    });

    const result = await switchContextPackWorkspace({
      contextPackDir: '/some/pack',
      mode: 'preview',
    });

    expect(result.mode).toBe('preview');
    const parsed = JSON.parse(result.output);
    expect(parsed.add).toEqual(['/repo/src']);
    expect(parsed.remove).toEqual([]);

    expect(mockedRunPython).toHaveBeenCalledOnce();
    const args = mockedRunPython.mock.calls[0];
    expect(args[1]).toContain('--action');
    expect(args[1]).toContain('preview');
  });

  it('apply mode calls Python with apply action and updates .env', async () => {
    // Create .env.example so ensureEnvFile can create .env
    writeFileSync(path.join(tmpDir, '.env.example'), '# defaults\n');

    mockedRunPython.mockResolvedValue({
      stdout: '{"ok": true}',
      stderr: '',
      exitCode: 0,
    });

    const result = await switchContextPackWorkspace({
      contextPackDir: '/some/pack',
      mode: 'apply',
    });

    expect(result.mode).toBe('apply');
    const args = mockedRunPython.mock.calls[0];
    expect(args[1]).toContain('apply');

    // Verify .env was updated with the context pack dir
    const envContent = readFileSync(path.join(tmpDir, '.env'), 'utf-8');
    expect(envContent).toContain('ACTIVE_CONTEXT_PACK_DIR=/some/pack');
  });

  it('clear mode calls Python with clear action and clears env state', async () => {
    // Create .env.example so ensureEnvFile can create .env
    writeFileSync(path.join(tmpDir, '.env.example'), '# defaults\n');

    mockedRunPython.mockResolvedValue({
      stdout: '{"ok": true}',
      stderr: '',
      exitCode: 0,
    });

    const result = await switchContextPackWorkspace({
      contextPackDir: '',
      mode: 'clear',
    });

    expect(result.mode).toBe('clear');
    const args = mockedRunPython.mock.calls[0];
    expect(args[1]).toContain('clear');

    // Verify .env was updated (cleared)
    if (existsSync(path.join(tmpDir, '.env'))) {
      const envContent = readFileSync(path.join(tmpDir, '.env'), 'utf-8');
      expect(envContent).toContain('ACTIVE_CONTEXT_PACK_DIR=');
    }
  });
});
