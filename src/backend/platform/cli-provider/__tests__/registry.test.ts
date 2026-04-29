import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getActiveProvider,
  loadCliProvider,
  resetProvider,
  resolveCliProviderId,
} from '../registry.js';

let repoRoot: string;

function writeRuntimeConfig(content: unknown): void {
  const stateDir = path.join(repoRoot, '.platform-state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'platform.json'), JSON.stringify(content), 'utf-8');
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-provider-registry-'));
  resetProvider();
  delete process.env['TASKSAIL_CLI_PROVIDER'];
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  resetProvider();
  delete process.env['TASKSAIL_CLI_PROVIDER'];
});

describe('cli-provider registry', () => {
  it('uses explicit provider id first', () => {
    process.env['TASKSAIL_CLI_PROVIDER'] = 'not-registered';
    expect(resolveCliProviderId(repoRoot, 'copilot')).toBe('copilot');
    expect(loadCliProvider(repoRoot, 'copilot').id).toBe('copilot');
  });

  it('uses TASKSAIL_CLI_PROVIDER before runtime config', () => {
    writeRuntimeConfig({ schema_version: 1, cli_provider: 'not-registered', container_runtime: 'podman' });
    process.env['TASKSAIL_CLI_PROVIDER'] = 'copilot';
    expect(resolveCliProviderId(repoRoot)).toBe('copilot');
  });

  it('uses runtime config provider when present', () => {
    writeRuntimeConfig({ schema_version: 1, cli_provider: 'copilot', container_runtime: 'podman' });
    expect(resolveCliProviderId(repoRoot)).toBe('copilot');
  });

  it('defaults to copilot when runtime config is missing', () => {
    expect(resolveCliProviderId(repoRoot)).toBe('copilot');
    expect(getActiveProvider(repoRoot).id).toBe('copilot');
  });

  it('fails closed for invalid providers with registered provider list', () => {
    writeRuntimeConfig({ schema_version: 1, cli_provider: 'codex', container_runtime: 'podman' });
    expect(() => resolveCliProviderId(repoRoot)).toThrow(/Unknown CLI provider "codex".*copilot/);
  });

  it('fails closed for malformed runtime config', () => {
    const stateDir = path.join(repoRoot, '.platform-state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'platform.json'), '{ broken json', 'utf-8');

    expect(() => resolveCliProviderId(repoRoot)).toThrow(/Invalid platform config/);
  });

  it('fails closed for blank provider overrides', () => {
    process.env['TASKSAIL_CLI_PROVIDER'] = '   ';
    expect(() => resolveCliProviderId(repoRoot)).toThrow(/TASKSAIL_CLI_PROVIDER must be a non-empty string/);
  });

  it('caches provider instances by repo root and resets cache for tests', () => {
    const first = getActiveProvider(repoRoot);
    const second = getActiveProvider(repoRoot);
    expect(second).toBe(first);

    resetProvider(repoRoot);

    const third = getActiveProvider(repoRoot);
    expect(third).toBe(first);
  });

  it('does not reread runtime provider config on active-provider cache hits', () => {
    writeRuntimeConfig({ schema_version: 1, cli_provider: 'copilot', container_runtime: 'podman' });
    const first = getActiveProvider(repoRoot);

    writeRuntimeConfig({ schema_version: 1, cli_provider: 'not-registered', container_runtime: 'podman' });

    expect(getActiveProvider(repoRoot)).toBe(first);

    resetProvider(repoRoot);
    expect(() => getActiveProvider(repoRoot)).toThrow(/Unknown CLI provider "not-registered"/);
  });
});
