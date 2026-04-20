/**
 * §3.1 Per-task context pack sidecar — Done-when test.
 *
 * Verifies that activating a pending item writes
 * AgentWorkSpace/tasks/<taskId>/.task.json with the required §3.1 schema
 * fields and state: "active".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activateNextPendingItemIfReady } from '../operations.js';
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME, resolveQueuePaths } from '../paths.js';
import { readTaskJson, readTaskJsonSafe, isTaskSidecarError } from '../taskJson.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/active.js';
import { composeProjectName } from '../../container/containerNaming.js';

describe('§3.1 per-task .task.json sidecar', () => {
  let repoRoot: string;
  let pendingDir: string;
  let handoffsDir: string;
  let templatesDir: string;

  beforeEach(() => {
    // The function derives repoRoot as path.resolve(pendingDir, '..', '..')
    // so we must replicate the canonical AgentWorkSpace structure:
    //   <repoRoot>/AgentWorkSpace/pendingitems/
    //   <repoRoot>/AgentWorkSpace/handoffs/
    //   <repoRoot>/AgentWorkSpace/templates/
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-taskjson-'));
    pendingDir = path.join(repoRoot, 'AgentWorkSpace', 'pendingitems');
    handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'handoffs');
    templatesDir = path.join(repoRoot, 'AgentWorkSpace', 'templates');
    mkdirSync(pendingDir, { recursive: true });
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(templatesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('writes .task.json with state "active" at AgentWorkSpace/tasks/<taskId>/ upon activation', async () => {
    const taskId = 'task-json-test-a';

    // Seed a minimal pending item
    writeFileSync(
      path.join(pendingDir, `${taskId}.md`),
      `# Task JSON Test A\n`,
    );

    // Seed required template files
    for (const filename of HANDOFF_FILES) {
      writeFileSync(path.join(templatesDir, filename), `# ${filename}\n`);
    }
    writeFileSync(path.join(templatesDir, SLICE_TEMPLATE_FILENAME), '# slice\n');

    const queuePaths = resolveQueuePaths(repoRoot);
    const result = await activateNextPendingItemIfReady({
      paths: queuePaths,
      repoRoot,
    });

    expect(result.activated).toBe(true);

    // The per-task sidecar must exist at the canonical path
    const sidecarPath = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId, '.task.json');
    expect(existsSync(sidecarPath)).toBe(true);

    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as Record<string, unknown>;

    // Required §3.1 schema fields
    expect(sidecar['schema_version']).toBe(1);
    expect(sidecar['taskId']).toBe(taskId);
    expect(sidecar['state']).toBe('active');
    expect(sidecar['finalizedAt']).toBeNull();
    expect(typeof sidecar['frozenAt']).toBe('string');

    // contextPackBinding block must be present with required sub-fields
    const cpb = sidecar['contextPackBinding'] as Record<string, unknown>;
    expect(cpb).toBeDefined();
    expect('contextPackPath' in cpb).toBe(true);
    // §3.1 schema contract: contextPackPath is a FILE path; path.dirname must
    // round-trip back to the context pack directory for §3.2 consumers.
    // At L0 the in-scope binding lacks a contextPackDir (extractContextPackBinding
    // returns null for the minimal pending-item fixture), so contextPackPath is null.
    // Verify the null-branch explicitly. A later test under §3.2 will cover the
    // non-null branch with a real context pack fixture.
    expect(cpb['contextPackPath']).toBeNull();
    expect('dataHostDir' in cpb).toBe(true);
    expect('dataContainerDir' in cpb).toBe(true);
    expect(Array.isArray(cpb['repoBindings'])).toBe(true);

    const repoBindings = cpb['repoBindings'] as Array<Record<string, unknown>>;
    expect(repoBindings).toHaveLength(1);
    const rb = repoBindings[0];
    expect(rb['originalRoot']).toBe(repoRoot);
    expect(rb['worktreeRoot']).toBe(repoRoot);
    expect(rb['worktreeBranch']).toBe(`task/${taskId}`);
    expect(typeof rb['baseCommitSha']).toBe('string');

    // materialization block
    const mat = sidecar['materialization'] as Record<string, unknown>;
    expect(mat).toBeDefined();
    expect(mat['strategy']).toBe('copy');
    expect(mat['composeProjectName']).toBe(composeProjectName(taskId));
    expect(Array.isArray(mat['cloned'])).toBe(true);
    expect(Array.isArray(mat['skipped'])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §3.2 taskJson reader — error handling and policy-layer integration
// ---------------------------------------------------------------------------

describe('§3.2 taskJson reader and env-reads policy layer', () => {
  let repoRoot: string;
  let savedTaskId: string | undefined;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-taskjson32-'));
    savedTaskId = process.env['TASKSAIL_TASK_ID'];
    delete process.env['TASKSAIL_TASK_ID'];
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    if (savedTaskId !== undefined) {
      process.env['TASKSAIL_TASK_ID'] = savedTaskId;
    } else {
      delete process.env['TASKSAIL_TASK_ID'];
    }
  });

  // -------------------------------------------------------------------------
  // readTaskJson error cases
  // -------------------------------------------------------------------------

  it('throws task-sidecar-missing when .task.json does not exist', () => {
    expect(() => readTaskJson('nonexistent-task', repoRoot)).toThrow();
    let caughtPayload: Record<string, unknown> | undefined;
    try {
      readTaskJson('nonexistent-task', repoRoot);
    } catch (err) {
      if (isTaskSidecarError(err)) {
        caughtPayload = err.payload as unknown as Record<string, unknown>;
      }
    }
    expect(caughtPayload).toBeDefined();
    expect(caughtPayload!['code']).toBe('task-sidecar-missing');
    expect(caughtPayload!['taskId']).toBe('nonexistent-task');
  });

  it('throws task-sidecar-corrupt when JSON is truncated', () => {
    const taskId = 'corrupt-task';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), '{"schema_version":1,"context');

    let caughtPayload: Record<string, unknown> | undefined;
    try {
      readTaskJson(taskId, repoRoot);
    } catch (err) {
      if (isTaskSidecarError(err)) {
        caughtPayload = err.payload as unknown as Record<string, unknown>;
      }
    }
    expect(caughtPayload).toBeDefined();
    expect(caughtPayload!['code']).toBe('task-sidecar-corrupt');
    expect(caughtPayload!['taskId']).toBe(taskId);
    // parseError must be populated for JSON parse failures
    expect(typeof caughtPayload!['parseError']).toBe('string');
  });

  it('throws task-sidecar-corrupt when contextPackBinding is absent (shape check)', () => {
    const taskId = 'missing-binding-task';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({ schema_version: 1, taskId, state: 'active' }),
    );

    let caughtPayload: Record<string, unknown> | undefined;
    try {
      readTaskJson(taskId, repoRoot);
    } catch (err) {
      if (isTaskSidecarError(err)) {
        caughtPayload = err.payload as unknown as Record<string, unknown>;
      }
    }
    expect(caughtPayload).toBeDefined();
    expect(caughtPayload!['code']).toBe('task-sidecar-corrupt');
  });

  it('throws task-sidecar-stale-schema when schema_version is 0', () => {
    const taskId = 'stale-schema-task';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        schema_version: 0,
        taskId,
        state: 'active',
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [],
        },
      }),
    );

    let caughtPayload: Record<string, unknown> | undefined;
    try {
      readTaskJson(taskId, repoRoot);
    } catch (err) {
      if (isTaskSidecarError(err)) {
        caughtPayload = err.payload as unknown as Record<string, unknown>;
      }
    }
    expect(caughtPayload).toBeDefined();
    expect(caughtPayload!['code']).toBe('task-sidecar-stale-schema');
    expect(caughtPayload!['foundVersion']).toBe(0);
    expect(caughtPayload!['expectedVersion']).toBe(1);
  });

  it('F33 + B7-data: succeeds and normalizes absent schema_version to current (2) in-memory', () => {
    const taskId = 'no-version-task';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        // schema_version intentionally absent — defaults to 1, then B7-data
        // normalization bumps the IN-MEMORY shape to CURRENT (2). The on-disk
        // file is left untouched (no mtime churn → platform-config cache safe).
        taskId,
        state: 'active',
        frozenAt: new Date().toISOString(),
        finalizedAt: null,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [],
        },
        materialization: {
          strategy: 'copy',
          cloned: [],
          skipped: [],
          composeProjectName: 'repo-context-mcp',
        },
      }),
    );

    const result = readTaskJson(taskId, repoRoot);
    expect(result.schema_version).toBe(2);
    expect(result.taskId).toBe(taskId);

    // On-disk file MUST NOT have been rewritten — verify schema_version is
    // still absent on disk (normalization is read-side only).
    const onDisk = JSON.parse(
      readFileSync(path.join(taskDir, '.task.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect('schema_version' in onDisk).toBe(false);
  });

  // -------------------------------------------------------------------------
  // requireAuthorizedActiveContextPack with TASKSAIL_TASK_ID
  // -------------------------------------------------------------------------

  it('rejects with task-sidecar-missing when TASKSAIL_TASK_ID is set but sidecar is absent', async () => {
    process.env['TASKSAIL_TASK_ID'] = 'a';
    // Do NOT create AgentWorkSpace/tasks/a/.task.json

    let caughtError: unknown;
    try {
      await requireAuthorizedActiveContextPack({ repoRoot });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(isTaskSidecarError(caughtError)).toBe(true);
    if (isTaskSidecarError(caughtError)) {
      expect(caughtError.payload.code).toBe('task-sidecar-missing');
    }
  });

  // readTaskJsonSafe returns null on corrupt (not throw)
  it('readTaskJsonSafe returns null for corrupt sidecar', () => {
    const taskId = 'safe-corrupt';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(path.join(taskDir, '.task.json'), 'NOT JSON {{{');
    const result = readTaskJsonSafe(taskId, repoRoot);
    expect(result).toBeNull();
  });

  // -------------------------------------------------------------------------
  // §B7-data schema v2 normalization and per-binding mergedAt/mergedVia surfacing
  // -------------------------------------------------------------------------

  it('B7-data: reads a v1 on-disk sidecar and surfaces in-memory schema_version=2 with mergedAt undefined', () => {
    const taskId = 'b7-v1-sidecar';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        state: 'completed',
        frozenAt: new Date().toISOString(),
        finalizedAt: new Date().toISOString(),
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [{
            originalRoot: '/tmp/origin',
            worktreeRoot: '/tmp/wt',
            worktreeBranch: `task/${taskId}`,
            baseCommitSha: 'deadbeef',
            // mergedAt + mergedVia intentionally absent on v1
          }],
        },
        materialization: {
          strategy: 'copy',
          cloned: [],
          skipped: [],
          composeProjectName: 'tasksail-' + taskId,
        },
      }, null, 2) + '\n',
    );

    const result = readTaskJson(taskId, repoRoot);
    // Reader-side normalization: in-memory shape is uniformly v2.
    expect(result.schema_version).toBe(2);
    // Per-binding v2 fields surface as undefined for v1 records.
    const binding = result.contextPackBinding.repoBindings[0]!;
    expect(binding.mergedAt).toBeUndefined();
    expect(binding.mergedVia).toBeUndefined();

    // On-disk version must remain 1 (no destructive rewrite on read).
    const onDisk = JSON.parse(
      readFileSync(path.join(taskDir, '.task.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(onDisk['schema_version']).toBe(1);
  });

  it('B7-data: reads a v2 sidecar with per-binding mergedAt/mergedVia and surfaces them verbatim', () => {
    const taskId = 'b7-v2-sidecar';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    const mergedTs = '2026-04-15T12:34:56.000Z';
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        schema_version: 2,
        taskId,
        state: 'completed',
        frozenAt: new Date().toISOString(),
        finalizedAt: new Date().toISOString(),
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [
            {
              originalRoot: '/tmp/origin-1',
              worktreeRoot: '/tmp/wt-1',
              worktreeBranch: `task/${taskId}`,
              baseCommitSha: 'aaaa1111',
              mergedAt: mergedTs,
              mergedVia: 'merged-into-head',
            },
            {
              originalRoot: '/tmp/origin-2',
              worktreeRoot: '/tmp/wt-2',
              worktreeBranch: `task/${taskId}`,
              baseCommitSha: 'bbbb2222',
              mergedAt: mergedTs,
              mergedVia: 'branch-deleted',
            },
          ],
        },
        materialization: {
          strategy: 'copy',
          cloned: [],
          skipped: [],
          composeProjectName: 'tasksail-' + taskId,
        },
      }, null, 2) + '\n',
    );

    const result = readTaskJson(taskId, repoRoot);
    expect(result.schema_version).toBe(2);
    const [b1, b2] = result.contextPackBinding.repoBindings;
    expect(b1!.mergedAt).toBe(mergedTs);
    expect(b1!.mergedVia).toBe('merged-into-head');
    expect(b2!.mergedAt).toBe(mergedTs);
    expect(b2!.mergedVia).toBe('branch-deleted');
  });

  // §3.5 Phase 3 gate — sidecar wins over mutated .env under TASKSAIL_TASK_ID.
  it('§3.5: with TASKSAIL_TASK_ID set, returns the sidecar-bound pack even when .env is mutated mid-run', async () => {
    const taskId = 'task-a';
    const packADir = path.join(repoRoot, 'packs', 'a');
    const packBDir = path.join(repoRoot, 'packs', 'b');
    mkdirSync(packADir, { recursive: true });
    mkdirSync(packBDir, { recursive: true });

    // Activate task A with a sidecar pointing at pack A.
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        schema_version: 1,
        taskId,
        state: 'active',
        frozenAt: new Date().toISOString(),
        finalizedAt: null,
        contextPackBinding: {
          contextPackPath: path.join(packADir, 'context-pack.json'),
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [],
        },
        materialization: {
          strategy: 'copy',
          cloned: [],
          skipped: [],
          composeProjectName: 'repo-context-mcp',
        },
      }, null, 2) + '\n',
    );

    // Mutate .env mid-run to point at pack B — should NOT affect task A's binding.
    writeFileSync(
      path.join(repoRoot, '.env'),
      `ACTIVE_CONTEXT_PACK_DIR=${packBDir}\n`,
    );

    process.env['TASKSAIL_TASK_ID'] = taskId;
    const resolved = await requireAuthorizedActiveContextPack({ repoRoot });

    expect(resolved).toBe(packADir);
    expect(resolved).not.toBe(packBDir);
  });
});
