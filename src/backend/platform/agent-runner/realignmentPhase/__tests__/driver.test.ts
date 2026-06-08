import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  acquireDirLock: vi.fn(),
  runStandaloneRoleAgent: vi.fn(),
  runPython: vi.fn(),
  buildRealignmentContextBundle: vi.fn(),
  buildRealignmentPrompt: vi.fn(),
}));

vi.mock('../../../queue/dirLock.js', () => ({
  acquireDirLock: mocks.acquireDirLock,
}));

vi.mock('../../standaloneRoleAgent.js', () => ({
  runStandaloneRoleAgent: mocks.runStandaloneRoleAgent,
}));

vi.mock('../bundle.js', () => ({
  buildRealignmentContextBundle: mocks.buildRealignmentContextBundle,
}));

vi.mock('../prompt.js', () => ({
  buildRealignmentPrompt: mocks.buildRealignmentPrompt,
}));

vi.mock('../../../core/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../../core/index.js')>('../../../core/index.js');
  return {
    ...actual,
    runPython: mocks.runPython,
  };
});

const { PythonRunError } = await import('../../../core/index.js');
const { executeRealignmentSession } = await import('../driver.js');

describe('executeRealignmentSession', () => {
  const repoRoot = path.join(process.cwd(), '.platform-state', 'test-realignment-driver');
  const contextPackDir = path.join(repoRoot, 'contextpacks', 'pack-a');
  const release = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    rmSync(repoRoot, { recursive: true, force: true });
    mkdirSync(contextPackDir, { recursive: true });
    mocks.acquireDirLock.mockResolvedValue(release);
    mocks.buildRealignmentContextBundle.mockResolvedValue({ realignmentId: 'RA-1' });
    mocks.buildRealignmentPrompt.mockResolvedValue('Prompt override');
    mocks.runStandaloneRoleAgent.mockImplementation(async ({ extraEnv }) => {
      writeFileSync(extraEnv.TASKSAIL_REALIGNMENT_STAGING_PATH, [
        '## Failure Analysis',
        'Failure.',
        '## Root Cause',
        'Cause.',
        '## Corrective Actions',
        '- Action.',
        '## Validation Notes',
        'Validated.',
        '## Meeting Notes',
        'Notes.',
      ].join('\n'), 'utf-8');
    });
    mocks.runPython.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'archived',
        global_realignment_version: 4,
      }),
      stderr: '',
      exitCode: 0,
    });
    seedSessions([session('RA-1', 'open')]);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('loads the session before lock, launches Ron, parses staging, ingests stdin, and releases the lock', async () => {
    const externalMcpRegistry = {
      schema_version: 1,
      external_servers: [],
    };
    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
      externalMcpRegistry,
    });

    expect(result).toEqual({
      passed: true,
      realignmentId: 'RA-1',
      status: 'archived',
      globalRealignmentVersion: 4,
    });
    expect(mocks.acquireDirLock).toHaveBeenCalledWith(
      path.join(repoRoot, '.platform-state', 'runtime', 'realignment', 'pack-a', 'realignment.lock'),
      1,
    );
    expect(mocks.buildRealignmentContextBundle).toHaveBeenCalledWith({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
      triggerTaskId: 'TASK-1',
      triggerFeedbackId: 'FB-1',
    });
    expect(mocks.buildRealignmentPrompt).toHaveBeenCalledWith({
      repoRoot,
      bundle: { realignmentId: 'RA-1' },
      externalMcpRegistry,
    });
    expect(mocks.runStandaloneRoleAgent).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'ron',
      repoRoot,
      contextPackDir,
      runtimeDir: path.join(repoRoot, '.platform-state', 'runtime', 'realignment', 'RA-1'),
      launchPhase: 'Realignment',
      promptOverride: 'Prompt override',
      extraAllowedDirs: [path.join(repoRoot, '.platform-state', 'runtime', 'realignment', 'RA-1')],
      extraEnv: {
        TASKSAIL_REALIGNMENT_STAGING_PATH: path.join(repoRoot, '.platform-state', 'runtime', 'realignment', 'RA-1', 'analysis.md'),
      },
    }));
    expect(mocks.runPython).toHaveBeenCalledWith(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py'),
      [
        '--repo-root', repoRoot,
        '--context-pack-dir', contextPackDir,
        '--realignment-id', 'RA-1',
        '--stdin',
      ],
      expect.objectContaining({
        cwd: repoRoot,
        stdin: expect.stringContaining('"failure_analysis":"Failure."'),
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing session', [] as ReturnType<typeof session>[], 'RA-missing', 'error', 'session_not_found'] as const,
    ['non-analyzable session', [session('RA-1', 'archived')], 'RA-1', 'skipped', 'session_not_analyzable'] as const,
  ])('returns early without acquiring the lock for %s', async (_label, sessions, id, status, reason) => {
    seedSessions([...sessions]);

    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: id,
    });

    expect(result).toEqual({ passed: false, realignmentId: id, status, reason });
    expect(mocks.acquireDirLock).not.toHaveBeenCalled();
  });

  it('returns skipped on lock contention', async () => {
    mocks.acquireDirLock.mockResolvedValue(null);

    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
    });

    expect(result).toEqual({
      passed: false,
      realignmentId: 'RA-1',
      status: 'skipped',
      reason: 'realignment_in_progress',
    });
    expect(mocks.runStandaloneRoleAgent).not.toHaveBeenCalled();
  });

  it('marks pre-promotion failures as error and releases the lock', async () => {
    mocks.runStandaloneRoleAgent.mockRejectedValue(new Error('Ron failed before writing staging'));
    mocks.runPython.mockResolvedValue({
      stdout: JSON.stringify({ status: 'error' }),
      stderr: '',
      exitCode: 0,
    });

    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
    });

    expect(result.status).toBe('error');
    expect(result.reason).toBe('ron_failed_before_writing_staging');
    expect(mocks.runPython).toHaveBeenCalledWith(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py'),
      [
        '--repo-root', repoRoot,
        '--context-pack-dir', contextPackDir,
        '--realignment-id', 'RA-1',
        '--mark-error',
        '--reason', 'ron_failed_before_writing_staging',
      ],
      expect.objectContaining({ cwd: repoRoot }),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('returns partial on promotion-committed ingest failure without mark-error', async () => {
    mocks.runPython.mockRejectedValue(new PythonRunError('ingest failed', {
      stdout: JSON.stringify({
        status: 'partial',
        reason: 'promotion_committed_archive_failed',
        global_realignment_version: 9,
      }),
      stderr: '',
      exitCode: 1,
    }));

    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
    });

    expect(result).toEqual({
      passed: false,
      realignmentId: 'RA-1',
      status: 'partial',
      reason: 'promotion_committed_archive_failed',
      globalRealignmentVersion: 9,
    });
    expect(mocks.runPython).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('recovers a reviewed partial session by archiving without relaunching Ron', async () => {
    seedSessions([session('RA-1', 'reviewed')]);
    mocks.runPython.mockResolvedValue({
      stdout: JSON.stringify({
        status: 'archived',
        global_realignment_version: 9,
      }),
      stderr: '',
      exitCode: 0,
    });

    const result = await executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
    });

    expect(result).toEqual({
      passed: true,
      realignmentId: 'RA-1',
      status: 'archived',
      globalRealignmentVersion: 9,
    });
    expect(mocks.runStandaloneRoleAgent).not.toHaveBeenCalled();
    expect(mocks.runPython).toHaveBeenCalledWith(
      path.join(repoRoot, 'src', 'backend', 'scripts', 'python', 'realignment-ingest.py'),
      [
        '--repo-root', repoRoot,
        '--context-pack-dir', contextPackDir,
        '--realignment-id', 'RA-1',
        '--archive-reviewed',
      ],
      expect.objectContaining({ cwd: repoRoot }),
    );
  });

  it('migrates legacy realignment sessions before loading the session', async () => {
    seedSessions([session('RA-1', 'open')], { legacy: true });

    await expect(executeRealignmentSession({
      repoRoot,
      contextPackDir,
      realignmentId: 'RA-1',
    })).resolves.toMatchObject({ status: 'archived' });

    expect(mocks.buildRealignmentContextBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        realignmentId: 'RA-1',
      }),
    );
  });

  function seedSessions(
    entries: Record<string, unknown>[],
    options: { legacy?: boolean } = {},
  ): void {
    const sessionsPath = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      ...(options.legacy ? ['reinforcement'] : ['global', 'reinforcement', 'store']),
      'realignment',
      'sessions.json',
    );
    mkdirSync(path.dirname(sessionsPath), { recursive: true });
    writeFileSync(sessionsPath, JSON.stringify({ entries }), 'utf-8');
  }
});

function session(realignmentId: string, status: string): Record<string, unknown> {
  return {
    realignment_id: realignmentId,
    trigger_task_id: 'TASK-1',
    trigger_feedback_id: 'FB-1',
    participating_agents: ['qa'],
    failure_analysis: '',
    root_cause: '',
    corrective_actions: [],
    status,
    meeting_notes: '',
    created_at: '2026-01-01T00:00:00Z',
  };
}
