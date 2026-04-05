import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { detectOS, setupRepo } from '../setup.js';

const execFileAsync = promisify(execFile);

describe('detectOS', () => {
  it('returns the current platform', () => {
    const result = detectOS();
    expect(['darwin', 'linux', 'win32']).toContain(result);
    expect(result).toBe(process.platform);
  });
});

describe('setupRepo', () => {
  let tmpDir: string;

  beforeEach(async () => {
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
  });

  afterEach(async () => {
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
    expect(fs.existsSync(path.join(tmpDir, 'AgentWorkSpace', 'handoffs'))).toBe(true);
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

  it('skips container services when skipContainerServices is true', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipContainerServices: true });
    const containerServicesStep = result.steps.find(s => s.name === 'container-services');
    expect(containerServicesStep?.status).toBe('skipped');
    expect(containerServicesStep?.message).toBe('skipContainerServices=true');
  });

  it('supports skipDocker as a deprecated alias', async () => {
    const result = await setupRepo({ repoRoot: tmpDir, skipDocker: true });
    const containerServicesStep = result.steps.find(s => s.name === 'container-services');
    expect(containerServicesStep?.status).toBe('skipped');
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
