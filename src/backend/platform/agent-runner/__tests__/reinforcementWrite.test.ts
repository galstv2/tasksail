import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PythonRunError } from '../../core/types.js';

vi.mock('../../core/pythonRunner.js', () => ({
  detectPythonBin: () => 'python3',
  runPython: vi.fn(),
}));

vi.mock('../../core/paths.js', () => ({
  findRepoRoot: () => '/fake/repo',
  resolvePaths: vi.fn(),
  resolvePath: vi.fn(),
  ensurePathWithinDropbox: vi.fn(),
}));

vi.mock('../../context-pack/index.js', () => ({
  requireAuthorizedActiveContextPack: vi.fn(),
}));

vi.mock('../realignmentPhase/driver.js', () => ({
  executeRealignmentSession: vi.fn(),
}));

vi.mock('../pipeline/externalMcpRegistryCache.js', () => ({
  prewarmExternalMcpRegistry: vi.fn(),
}));

vi.mock('../reinforcementPaths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reinforcementPaths.js')>();
  return {
    ...actual,
    readJsonSafe: vi.fn(),
  };
});

import { runPython } from '../../core/pythonRunner.js';
import { requireAuthorizedActiveContextPack } from '../../context-pack/index.js';
import { prewarmExternalMcpRegistry } from '../pipeline/externalMcpRegistryCache.js';
import { readJsonSafe } from '../reinforcementPaths.js';
import { executeRealignmentSession } from '../realignmentPhase/driver.js';
import {
  dismissRealignmentSession,
  runRealignmentAnalysis,
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
} from '../reinforcementWrite.js';

const mockRunPython = vi.mocked(runPython);
const mockRequireAuthorizedActiveContextPack = vi.mocked(requireAuthorizedActiveContextPack);
const mockPrewarmExternalMcpRegistry = vi.mocked(prewarmExternalMcpRegistry);
const mockExecuteRealignmentSession = vi.mocked(executeRealignmentSession);
const mockReadJsonSafe = vi.mocked(readJsonSafe);

describe('submitReinforcementFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockReadJsonSafe.mockResolvedValue(null);
  });

  it('builds correct args and parses JSON stdout', async () => {
    const jsonOutput = { event: { feedback_id: 'f1' }, realignment_recommended: false };
    mockRunPython.mockResolvedValue({
      stdout: JSON.stringify(jsonOutput),
      stderr: '',
      exitCode: 0,
    });

    const result = await submitReinforcementFeedback({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-1',
      feedbackType: 'positive',
      starRating: 4,
      comment: 'good work',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(true);
    expect(result.data).toEqual(jsonOutput);

    const [scriptPath, args] = mockRunPython.mock.calls[0]!;
    expect(scriptPath).toContain('submit-reinforcement-feedback.py');
    expect(args).toContain('--repo-root');
    expect(args).toContain('/fake/repo');
    expect(args).toContain('--context-pack-dir');
    expect(args).toContain('/packs/pack-a');
    expect(args).toContain('--task-id');
    expect(args).toContain('task-1');
    expect(args).toContain('--feedback-type');
    expect(args).toContain('positive');
    expect(args).toContain('--star-rating');
    expect(args).toContain('4');
    expect(args).toContain('--comment');
    expect(args).toContain('good work');
  });

  it('omits optional args when not provided', async () => {
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    await submitReinforcementFeedback({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-1',
      feedbackType: 'none',
      repoRoot: '/fake/repo',
    });

    const args = mockRunPython.mock.calls[0]![1] as string[];
    expect(args).not.toContain('--star-rating');
    expect(args).not.toContain('--comment');
  });

  it('returns passed=false on PythonRunError', async () => {
    mockRunPython.mockRejectedValue(
      new PythonRunError('exit 1', { stdout: '', stderr: 'boom', exitCode: 1 }),
    );

    const result = await submitReinforcementFeedback({
      contextPackDir: '/packs/pack-a',
      taskId: 'task-1',
      feedbackType: 'negative',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('boom');
  });

  it('rejects writes outside the authorized active context pack', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('Write operations are limited to the active context pack.'),
    );

    await expect(
      submitReinforcementFeedback({
        contextPackDir: '/packs/rogue-pack',
        taskId: 'task-1',
        feedbackType: 'negative',
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('Write operations are limited to the active context pack.');

    expect(mockRunPython).not.toHaveBeenCalled();
  });
});

describe('updateGlobalRealignmentDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
  });

  it('builds correct args in field/value mode', async () => {
    const docOutput = { field: 'updated' };
    mockRunPython.mockResolvedValue({
      stdout: JSON.stringify(docOutput),
      stderr: '',
      exitCode: 0,
    });

    const result = await updateGlobalRealignmentDoc({
      contextPackDir: '/packs/pack-a',
      field: 'priority',
      value: '"high"',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(true);
    expect(result.data).toEqual(docOutput);

    const [scriptPath, args] = mockRunPython.mock.calls[0]!;
    expect(scriptPath).toContain('update-global-realignment-doc.py');
    expect(args).toContain('--repo-root');
    expect(args).toContain('/fake/repo');
    expect(args).toContain('--field');
    expect(args).toContain('priority');
    expect(args).toContain('--value');
    expect(args).toContain('"high"');
    expect(args).not.toContain('--stdin');
  });

  it('passes stdin in bulk mode', async () => {
    mockRunPython.mockResolvedValue({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    });

    const payload = JSON.stringify({ a: 1, b: 2 });
    await updateGlobalRealignmentDoc({
      contextPackDir: '/packs/pack-a',
      stdin: payload,
      repoRoot: '/fake/repo',
    });

    const [, args, opts] = mockRunPython.mock.calls[0]!;
    expect(args).toContain('--stdin');
    expect(args).not.toContain('--field');
    expect((opts as { stdin?: string }).stdin).toBe(payload);
  });

  it('returns passed=false on PythonRunError', async () => {
    mockRunPython.mockRejectedValue(
      new PythonRunError('exit 1', { stdout: '', stderr: 'error', exitCode: 1 }),
    );

    const result = await updateGlobalRealignmentDoc({
      contextPackDir: '/packs/pack-a',
      field: 'x',
      value: '"y"',
      repoRoot: '/fake/repo',
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('rejects realignment writes outside the authorized active context pack', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('Write operations are limited to the active context pack.'),
    );

    await expect(
      updateGlobalRealignmentDoc({
        contextPackDir: '/packs/rogue-pack',
        field: 'x',
        value: '"y"',
        repoRoot: '/fake/repo',
      }),
    ).rejects.toThrow('Write operations are limited to the active context pack.');

    expect(mockRunPython).not.toHaveBeenCalled();
  });
});

describe('runRealignmentAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
    mockExecuteRealignmentSession.mockResolvedValue({
      passed: true,
      realignmentId: 'RA-1',
      status: 'archived',
      globalRealignmentVersion: 3,
    });
    mockPrewarmExternalMcpRegistry.mockResolvedValue({
      schema_version: 1,
      external_servers: [],
    });
  });

  it('authorizes the active context pack, loads external MCP registry, and calls the realignment driver', async () => {
    const abortController = new AbortController();
    const externalMcpRegistry = {
      schema_version: 1,
      external_servers: [{
        id: 'docs',
        display_name: 'Docs',
        enabled: true,
        purpose: 'reference checks',
        transport: 'http' as const,
        url: 'https://example.invalid',
        agent_scope: { mode: 'allowlist' as const, agent_ids: ['ron'] },
      }],
    };
    mockPrewarmExternalMcpRegistry.mockResolvedValue(externalMcpRegistry);

    const result = await runRealignmentAnalysis({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
      abortSignal: abortController.signal,
    });

    expect(result).toEqual({
      passed: true,
      realignmentId: 'RA-1',
      status: 'archived',
      globalRealignmentVersion: 3,
    });
    expect(mockRequireAuthorizedActiveContextPack).toHaveBeenCalledWith({
      repoRoot: '/fake/repo',
      requestedContextPackDir: '/packs/pack-a',
    });
    expect(mockPrewarmExternalMcpRegistry).toHaveBeenCalledWith('/fake/repo');
    expect(mockExecuteRealignmentSession).toHaveBeenCalledWith({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
      abortSignal: abortController.signal,
      externalMcpRegistry,
    });
  });

  it('uses an explicitly provided external MCP registry without reloading it', async () => {
    const externalMcpRegistry = {
      schema_version: 1,
      external_servers: [],
    };

    await runRealignmentAnalysis({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
      externalMcpRegistry,
    });

    expect(mockPrewarmExternalMcpRegistry).not.toHaveBeenCalled();
    expect(mockExecuteRealignmentSession).toHaveBeenCalledWith(expect.objectContaining({
      externalMcpRegistry,
    }));
  });

  it('rejects unauthorized context packs without launching the driver', async () => {
    mockRequireAuthorizedActiveContextPack.mockRejectedValue(
      new Error('Write operations are limited to the active context pack.'),
    );

    await expect(runRealignmentAnalysis({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/rogue-pack',
      realignmentId: 'RA-1',
    })).rejects.toThrow('Write operations are limited to the active context pack.');

    expect(mockExecuteRealignmentSession).not.toHaveBeenCalled();
  });
});

describe('dismissRealignmentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuthorizedActiveContextPack.mockResolvedValue('/packs/pack-a');
  });

  it('authorizes the active context pack and runs the dismiss script', async () => {
    mockRunPython.mockResolvedValue({
      stdout: '{"status":"dismissed","realignment_id":"RA-1"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await dismissRealignmentSession({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });

    expect(result.passed).toBe(true);
    expect(result.data).toEqual({ status: 'dismissed', realignment_id: 'RA-1' });
    expect(mockRequireAuthorizedActiveContextPack).toHaveBeenCalledWith({
      repoRoot: '/fake/repo',
      requestedContextPackDir: '/packs/pack-a',
    });
    const [scriptPath, args] = mockRunPython.mock.calls[0]!;
    expect(scriptPath).toContain('dismiss-realignment-session.py');
    expect(args).toContain('--realignment-id');
    expect(args).toContain('RA-1');
  });

  it('blocks dismissing an in-progress realignment', async () => {
    mockReadJsonSafe.mockResolvedValue({ status: 'running' });

    const result = await dismissRealignmentSession({
      repoRoot: '/fake/repo',
      contextPackDir: '/packs/pack-a',
      realignmentId: 'RA-1',
    });

    expect(result.passed).toBe(false);
    expect(result.stderr).toContain('realignment_in_progress');
    expect(mockRunPython).not.toHaveBeenCalled();
  });
});
