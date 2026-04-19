/**
 * §6.3 + F34 — containerNaming tests.
 *
 * Covers: passthrough path (F34-safe slugs), sanitization, fallback to sha256
 * when sanitization fails, determinism, Docker 63-char container-name limit.
 *
 * Also hosts the §6.4 phase-6 integration gate tests (gated by
 * RUN_CONTAINER_TESTS=1 because they spin real containers).
 *
 * Run: pnpm vitest run src/backend/platform/container/__tests__/containerNaming.test.ts
 * Integration: RUN_CONTAINER_TESTS=1 pnpm vitest run src/backend/platform/container/__tests__/containerNaming.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  taskContainerSlug,
  composeProjectName,
  repoContextMcpContainerName,
  COMPOSE_PROJECT_NAME_PREFIX,
  REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX,
  TASK_SLUG_MAX_LEN,
} from '../containerNaming.js';
import { allocate as allocatePort, release as releasePort } from '../portAllocator.js';
import { composeDownTask } from '../composeDownTask.js';
import { findRepoRoot } from '../../core/index.js';

describe('§6.3 containerNaming constants', () => {
  it('exports the canonical prefixes verbatim', () => {
    expect(COMPOSE_PROJECT_NAME_PREFIX).toBe('tasksail-');
    expect(REPO_CONTEXT_MCP_CONTAINER_NAME_PREFIX).toBe('repo-context-mcp-');
    expect(TASK_SLUG_MAX_LEN).toBe(46);
  });
});

describe('§6.3 taskContainerSlug — passthrough', () => {
  it('returns a lowercase [a-z0-9-] id unchanged when F34-safe', () => {
    expect(taskContainerSlug('feature-x')).toBe('feature-x');
    expect(taskContainerSlug('fix-123')).toBe('fix-123');
  });

  it('lowercases uppercase ids', () => {
    expect(taskContainerSlug('Feature-X')).toBe('feature-x');
  });

  it('replaces underscores and other specials with dashes', () => {
    expect(taskContainerSlug('feature_x_y')).toBe('feature-x-y');
    expect(taskContainerSlug('a/b.c')).toBe('a-b-c');
  });

  it('collapses consecutive dashes', () => {
    expect(taskContainerSlug('feature---x')).toBe('feature-x');
  });

  it('trims leading/trailing dashes before validating F34', () => {
    expect(taskContainerSlug('--foo--')).toBe('foo');
  });
});

describe('§6.3 taskContainerSlug — sha256 fallback', () => {
  it('falls back to 16-char hex when sanitized is empty (all specials)', () => {
    const slug = taskContainerSlug('!!!');
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });

  it('falls back when sanitized exceeds 46 chars', () => {
    const long = 'a'.repeat(60);
    const slug = taskContainerSlug(long);
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });

  it('is deterministic: same input → same fallback slug', () => {
    const a = taskContainerSlug('!!!');
    const b = taskContainerSlug('!!!');
    expect(a).toBe(b);
  });
});

describe('§6.3 F34 boundary — 46-char input passes, 47-char triggers fallback', () => {
  it('46-char lowercase alnum id passes through untouched', () => {
    const id = 'a'.repeat(46);
    expect(taskContainerSlug(id)).toBe(id);
  });

  it('47-char lowercase alnum id falls back to sha256', () => {
    const id = 'a'.repeat(47);
    const slug = taskContainerSlug(id);
    expect(slug).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('§6.3 composeProjectName + repoContextMcpContainerName', () => {
  it('prepends tasksail- and stays inside 63-char Docker cap for max slug', () => {
    const id = 'a'.repeat(46);
    const project = composeProjectName(id);
    expect(project).toBe(`tasksail-${id}`);
    expect(project.length).toBeLessThanOrEqual(63);
  });

  it('prepends repo-context-mcp- and exact-fits 63-char cap for max slug', () => {
    const id = 'a'.repeat(46);
    const name = repoContextMcpContainerName(id);
    expect(name).toBe(`repo-context-mcp-${id}`);
    expect(name.length).toBe(63);
  });

  it('fallback-slug container name is 33 chars (prefix 17 + sha256 16)', () => {
    const name = repoContextMcpContainerName('!!!');
    expect(name.length).toBe(33);
    expect(name).toMatch(/^repo-context-mcp-[a-f0-9]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// §6.4 phase-6 gate — integration tests (RUN_CONTAINER_TESTS=1)
//
// These tests spin REAL containers against the repo's docker-compose stack.
// They are skipped unless `RUN_CONTAINER_TESTS=1` is set in the environment.
// Run via:
//   RUN_CONTAINER_TESTS=1 pnpm vitest run \
//     src/backend/platform/container/__tests__/containerNaming.test.ts
// ---------------------------------------------------------------------------

const integrationEnabled = process.env['RUN_CONTAINER_TESTS'] === '1';
const maybeDescribe = integrationEnabled ? describe : describe.skip;

// Two deterministic task slugs matching the §6.4 prescription literally
// ("--task-id a", "--task-id b"). Narrow scope = easy forensic cleanup.
const TASK_A = 'a';
const TASK_B = 'b';

function dockerPsByName(filter: string): string {
  return execFileSync(
    'docker',
    ['ps', '--filter', `name=${filter}`, '--format', '{{.Names}}'],
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10_000 },
  ).trim();
}

function bootstrapTask(repoRoot: string, taskId: string): void {
  execFileSync(
    'npx',
    ['tsx', 'src/backend/platform/container/cli.ts', 'bootstrap', '--task-id', taskId],
    { cwd: repoRoot, stdio: 'inherit', timeout: 180_000 },
  );
}

async function bestEffortTearDownTask(repoRoot: string, taskId: string): Promise<void> {
  try { await composeDownTask(repoRoot, taskId); } catch { /* best-effort */ }
  try { await releasePort(taskId, repoRoot); } catch { /* best-effort */ }
}

maybeDescribe('§6.4 phase-6 gate — two-task bootstrap + composeDownTask', () => {
  // Cleanup is idempotent and runs after every test regardless of outcome.
  // Even if a test throws mid-flight, containers + port leases must be reaped.
  afterEach(async () => {
    const repoRoot = findRepoRoot();
    await bestEffortTearDownTask(repoRoot, TASK_A);
    await bestEffortTearDownTask(repoRoot, TASK_B);
  });

  it('bootstrap --task-id a && --task-id b → two live containers on distinct ports', async () => {
    const repoRoot = findRepoRoot();

    // Port allocation is a precondition of `bootstrap --task-id <id>` (cli.ts
    // fails-closed if the row is missing). Allocate both before bootstrap.
    const portA = await allocatePort(TASK_A, composeProjectName(TASK_A), repoRoot);
    const portB = await allocatePort(TASK_B, composeProjectName(TASK_B), repoRoot);
    expect(portA).not.toBe(portB);

    bootstrapTask(repoRoot, TASK_A);
    bootstrapTask(repoRoot, TASK_B);

    // Two containers visible via `docker ps`.
    const containerA = dockerPsByName(repoContextMcpContainerName(TASK_A));
    const containerB = dockerPsByName(repoContextMcpContainerName(TASK_B));
    expect(containerA).toBe(repoContextMcpContainerName(TASK_A));
    expect(containerB).toBe(repoContextMcpContainerName(TASK_B));

    // Both healthcheck endpoints return 200.
    for (const port of [portA, portB]) {
      const status = execFileSync(
        'curl',
        ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://localhost:${port}/sse`],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15_000 },
      ).trim();
      // The repo-context MCP serves SSE on /sse; 200 is the healthy status.
      expect(status).toBe('200');
    }

    // Port table records each task on a distinct port.
    const table = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.platform-state', 'runtime', 'port-allocations.json'),
        'utf-8',
      ),
    ) as Record<string, { port: number }>;
    expect(table[TASK_A]?.port).toBe(portA);
    expect(table[TASK_B]?.port).toBe(portB);
    expect(table[TASK_A]?.port).not.toBe(table[TASK_B]?.port);
  });

  it('composeDownTask(a) leaves b running; second composeDownTask(b) cleans up', async () => {
    const repoRoot = findRepoRoot();

    await allocatePort(TASK_A, composeProjectName(TASK_A), repoRoot);
    await allocatePort(TASK_B, composeProjectName(TASK_B), repoRoot);

    bootstrapTask(repoRoot, TASK_A);
    bootstrapTask(repoRoot, TASK_B);

    await composeDownTask(repoRoot, TASK_A);

    // Container A is gone; container B still live.
    expect(dockerPsByName(repoContextMcpContainerName(TASK_A))).toBe('');
    expect(dockerPsByName(repoContextMcpContainerName(TASK_B)))
      .toBe(repoContextMcpContainerName(TASK_B));

    // Tearing down B completes the picture (also verified by afterEach).
    await composeDownTask(repoRoot, TASK_B);
    expect(dockerPsByName(repoContextMcpContainerName(TASK_B))).toBe('');
  });
});
