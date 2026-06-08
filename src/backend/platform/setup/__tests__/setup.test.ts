import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setupRepo } from '../setup.js';

const execFileAsync = promisify(execFile);

// Mirror env vars that the enterprise-mirrors setup step reads from process.env.
// Cleared per test so host/CI env cannot make the step apply config or fire a
// live preflight fetch.
const MIRROR_ENV_KEYS = [
  'NPM_CONFIG_REGISTRY',
  'npm_config_registry',
  'NPM_CONFIG_REPLACE_REGISTRY_HOST',
  'npm_config_replace_registry_host',
  'PIP_INDEX_URL',
  'TASKSAIL_NPM_REGISTRY',
  'TASKSAIL_NPM_AUTH_TOKEN',
  'TASKSAIL_PYPI_INDEX_URL',
  'TASKSAIL_PYTHON_BASE_IMAGE',
  'TASKSAIL_ALPINE_BASE_IMAGE',
];

describe('setupRepo', () => {
  let tmpDir: string;
  let savedMirrorEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    savedMirrorEnv = {};
    for (const key of MIRROR_ENV_KEYS) {
      savedMirrorEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'setup-'));
    // Initialize a real git repo so git commands work
    await execFileAsync('git', ['init'], { cwd: tmpDir });
    // Create .env.example
    await fs.promises.writeFile(path.join(tmpDir, '.env.example'), 'KEY=value\n');
    await fs.promises.mkdir(path.join(tmpDir, 'config'), { recursive: true });
    await fs.promises.writeFile(
      path.join(tmpDir, 'config', 'platform.default.json'),
      JSON.stringify({ schema_version: 1, container_runtime: 'docker' }, null, 2),
    );
    await fs.promises.writeFile(
      path.join(tmpDir, 'config', 'deep-focus-ignore.default.json'),
      JSON.stringify({ extensions: [], patterns: [] }, null, 2),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const key of MIRROR_ENV_KEYS) {
      if (savedMirrorEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedMirrorEnv[key];
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .env from .env.example when .env does not exist', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const envStep = result.steps.find(s => s.name === 'ensure-env');
    expect(envStep?.status).toBe('ok');
    expect(fs.existsSync(path.join(tmpDir, '.env'))).toBe(true);
  });

  it('creates queue directories', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const queueStep = result.steps.find(s => s.name === 'queue-dirs');
    expect(queueStep?.status).toBe('ok');
    expect(fs.existsSync(path.join(tmpDir, 'AgentWorkSpace', 'dropbox'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'AgentWorkSpace', 'pendingitems'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'AgentWorkSpace', 'handoffs'))).toBe(false);
  });

  it('seeds platform config before MCP registry seeding', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const platformConfigStep = result.steps.find(s => s.name === 'platform-config-seed');
    expect(platformConfigStep?.status).toBe('ok');
    expect(fs.existsSync(path.join(tmpDir, '.platform-state', 'platform.json'))).toBe(true);

    const platformConfigIndex = result.steps.findIndex((s) => s.name === 'platform-config-seed');
    const mcpRegistryIndex = result.steps.findIndex((s) => s.name === 'mcp-registry-seed');
    expect(platformConfigIndex).toBeGreaterThan(-1);
    expect(mcpRegistryIndex).toBeGreaterThan(platformConfigIndex);
  });

  it('runs secure-env then enterprise-mirrors after ensure-env and before platform-config-seed', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const ensureEnvIndex = result.steps.findIndex((s) => s.name === 'ensure-env');
    const secureEnvIndex = result.steps.findIndex((s) => s.name === 'secure-env');
    const mirrorIndex = result.steps.findIndex((s) => s.name === 'enterprise-mirrors');
    const platformConfigIndex = result.steps.findIndex((s) => s.name === 'platform-config-seed');
    expect(ensureEnvIndex).toBeGreaterThan(-1);
    expect(secureEnvIndex).toBe(ensureEnvIndex + 1);
    expect(mirrorIndex).toBe(secureEnvIndex + 1);
    expect(platformConfigIndex).toBe(mirrorIndex + 1);
  });

  it('reports enterprise-mirrors skipped when no mirror vars are set', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const mirrorStep = result.steps.find((s) => s.name === 'enterprise-mirrors');
    expect(mirrorStep?.status).toBe('skipped');
    expect(fs.existsSync(path.join(tmpDir, '.npmrc'))).toBe(false);
  });

  it('applies mirror config from repo .env and reports ok when preflight succeeds', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, '.env.example'),
      'NPM_CONFIG_REGISTRY=https://corp.example/npm/\n',
    );
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));

    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const mirrorStep = result.steps.find((s) => s.name === 'enterprise-mirrors');
    expect(mirrorStep?.status).toBe('ok');
    // Config was applied to the generated (git-ignored) .npmrc after ensure-env.
    expect(fs.existsSync(path.join(tmpDir, '.npmrc'))).toBe(true);
    const npmrc = await fs.promises.readFile(path.join(tmpDir, '.npmrc'), 'utf-8');
    expect(npmrc).toContain('registry=https://corp.example/npm/');
  });

  it('reports enterprise-mirrors failed for an invalid URL without failing platform-config-seed', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, '.env.example'),
      'NPM_CONFIG_REGISTRY=:::not-a-url:::\n',
    );
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    expect(result.steps.find((s) => s.name === 'enterprise-mirrors')?.status).toBe('failed');
    expect(result.steps.find((s) => s.name === 'platform-config-seed')?.status).toBe('ok');
  });

  it('seeds the deep focus ignore runtime file from the tracked default', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });

    expect(result.steps.find((step) => step.name === 'deep-focus-ignore-seed')?.status).toBe('ok');
    expect(
      JSON.parse(
        await fs.promises.readFile(
          path.join(tmpDir, '.platform-state', 'deep-focus-ignore.json'),
          'utf-8',
        ),
      ),
    ).toEqual({ extensions: [], patterns: [] });
  });

  it('skips container services when skipContainerServices is true', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const containerServicesStep = result.steps.find(s => s.name === 'container-services');
    expect(containerServicesStep?.status).toBe('skipped');
    expect(containerServicesStep?.message).toBe('skipContainerServices=true');
  });

  it('returns detected OS in result', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    expect(result.os).toBe(process.platform);
  });

  it('marks tasksail.code-workspace as skip-worktree when tracked', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, 'tasksail.code-workspace'),
      '{ "folders": [] }\n',
    );
    await execFileAsync('git', ['add', 'tasksail.code-workspace'], { cwd: tmpDir });
    await execFileAsync('git', ['commit', '-m', 'track workspace'], {
      cwd: tmpDir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    });

    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });

    expect(result.steps.find((s) => s.name === 'skip-worktree')?.status).toBe('ok');

    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-v', 'tasksail.code-workspace'],
      { cwd: tmpDir },
    );
    expect(stdout.trim().startsWith('S ')).toBe(true);
  });
});
