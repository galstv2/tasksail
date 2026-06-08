// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { createSystemSettingsHandlers } from './systemSettingsHandlers';
import type { SystemSettingsSaveRequest } from '../../src/shared/desktopContract';

const FULL_DEFAULT = {
  schema_version: 1,
  cli_provider: 'copilot',
  slice_artifact_format: 'markdown',
  container_runtime: 'direct',
  container_engine_host: 'auto',
  container_engine_wsl_distro: null,
  max_parallel_tasks: 10,
  retain_failed_task_worktrees: true,
  max_retained_failed_task_worktrees: 10,
  max_retry_generations_per_slug: 5,
  completed_task_runtime_retention_ms: 3600000,
  auto_merge: false,
  external_mcp_local_enabled: true,
  mcp_port: 8811,
  repo_context_mcp_external_mount_roots: [],
} satisfies SystemSettingsSaveRequest['payload']['config'];

function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// Deterministic active-work probe so these tests do not depend on a live queue.
const noActiveWork = async (): Promise<boolean> => false;

let tmpDir: string;

function defaultPath(): string {
  return path.join(tmpDir, 'config', 'platform.default.json');
}
function runtimePath(): string {
  return path.join(tmpDir, '.platform-state', 'platform.json');
}
function writeDefault(raw: string): void {
  fs.mkdirSync(path.dirname(defaultPath()), { recursive: true });
  fs.writeFileSync(defaultPath(), raw, 'utf-8');
}
function writeRuntime(raw: string): void {
  fs.mkdirSync(path.dirname(runtimePath()), { recursive: true });
  fs.writeFileSync(runtimePath(), raw, 'utf-8');
}

async function readDefaultHash(): Promise<string> {
  const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).read();
  if (result.ok && result.response.action === 'systemSettings.read') {
    return result.response.defaultFileHash;
  }
  throw new Error('expected a successful read response');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-settings-handler-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('systemSettingsHandlers', () => {
  it('read returns an ok read response with config and a valid runtime mirror', async () => {
    writeDefault(serialize(FULL_DEFAULT));
    writeRuntime(serialize(FULL_DEFAULT));

    const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).read();

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'systemSettings.read') {
      expect(result.response.config.cli_provider).toBe('copilot');
      expect(result.response.runtimeStatus).toBe('valid');
      expect(result.response.runtimeWarning).toBeNull();
      expect(result.response.defaultFileHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.response.tasksActive).toBe(false);
    }
  });

  it('read returns a runtime warning when the runtime config is absent', async () => {
    writeDefault(serialize(FULL_DEFAULT));

    const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).read();

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'systemSettings.read') {
      expect(result.response.runtimeStatus).toBe('missing');
      expect(result.response.runtimeWarning).toContain('missing or invalid');
    }
  });

  it('save maps a stale default hash to a version_conflict error result', async () => {
    writeDefault(serialize(FULL_DEFAULT));
    writeRuntime(serialize(FULL_DEFAULT));

    const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).save({
      baseDefaultFileHash: 'stale-hash',
      config: FULL_DEFAULT,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('version_conflict');
      expect(result.error).toContain('Reload settings');
    }
    // Neither file was overwritten by the stale draft.
    expect(fs.readFileSync(defaultPath(), 'utf-8')).toBe(serialize(FULL_DEFAULT));
  });

  it('save returns a saved response and writes the files on a valid draft', async () => {
    writeDefault(serialize(FULL_DEFAULT));
    writeRuntime(serialize(FULL_DEFAULT));
    const hash = await readDefaultHash();

    const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).save({
      baseDefaultFileHash: hash,
      config: { ...FULL_DEFAULT, auto_merge: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'systemSettings.save') {
      expect(result.response.mode).toBe('saved');
      expect(result.response.runtimeStatus).toBe('valid');
      expect(result.response.config.auto_merge).toBe(true);
    }
    expect(JSON.parse(fs.readFileSync(defaultPath(), 'utf-8')).auto_merge).toBe(true);
    expect(JSON.parse(fs.readFileSync(runtimePath(), 'utf-8')).auto_merge).toBe(true);
  });

  it('save maps a validation failure to an ok:false result with field details', async () => {
    writeDefault(serialize(FULL_DEFAULT));
    writeRuntime(serialize(FULL_DEFAULT));
    const hash = await readDefaultHash();

    const result = await createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: noActiveWork }).save({
      baseDefaultFileHash: hash,
      config: { ...FULL_DEFAULT, mcp_port: 70000 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBeUndefined();
      expect((result.details ?? []).join(' ')).toContain('mcp_port');
    }
  });

  it('reports tasksActive on read and blocks save while a task is running', async () => {
    writeDefault(serialize(FULL_DEFAULT));
    writeRuntime(serialize(FULL_DEFAULT));
    const activeWork = async (): Promise<boolean> => true;
    const handlers = createSystemSettingsHandlers({ repoRoot: tmpDir, checkActiveWork: activeWork });

    const read = await handlers.read();
    expect(read.ok).toBe(true);
    if (read.ok && read.response.action === 'systemSettings.read') {
      expect(read.response.tasksActive).toBe(true);
    }

    const before = fs.readFileSync(defaultPath(), 'utf-8');
    const save = await handlers.save({ baseDefaultFileHash: 'whatever', config: FULL_DEFAULT });
    expect(save.ok).toBe(false);
    if (!save.ok) {
      expect(save.errorCode).toBe('active_work_blocked');
    }
    // No write happened while a task was active.
    expect(fs.readFileSync(defaultPath(), 'utf-8')).toBe(before);
  });
});
