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
import { HANDOFF_FILES, SLICE_TEMPLATE_FILENAME } from '../paths.js';
import { readTaskJson, readTaskJsonSafe, isTaskSidecarError } from '../taskJson.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/active.js';

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

    const activated = await activateNextPendingItemIfReady(
      pendingDir,
      handoffsDir,
      templatesDir,
    );

    expect(activated).toBe(true);

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
    expect(mat['composeProjectName']).toBe('repo-context-mcp');
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

  it('F33: succeeds and returns schema_version=1 when schema_version field is absent', () => {
    const taskId = 'no-version-task';
    const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      path.join(taskDir, '.task.json'),
      JSON.stringify({
        // schema_version intentionally absent
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
    expect(result.schema_version).toBe(1);
    expect(result.taskId).toBe(taskId);
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
});
