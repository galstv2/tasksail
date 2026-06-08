// @vitest-environment node

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

import { execSync } from 'node:child_process';

import { probePidLiveness, readObservabilitySnapshot, readQueueStatusSnapshot } from './repoObservability';
import { setCurrentActiveContextPackTaskScope } from './contextPack/taskVisibility';

const execSyncMock = vi.mocked(execSync);

describe('probePidLiveness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execSyncMock.mockReset();
  });

  it('uses best-effort PID liveness on Windows without shelling out to ps', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(probePidLiveness(48217, '2026-03-07T21:07:29Z', 'win32')).toBe('alive');
    expect(killSpy).toHaveBeenCalledWith(48217, 0);
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('keeps the POSIX PID reuse guard on Unix-like platforms', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true);
    execSyncMock.mockReturnValue('Fri Mar  7 21:10:40 2026');

    expect(probePidLiveness(48217, 'Fri Mar  7 21:07:29 2026', 'darwin')).toBe('not-found');
    expect(execSyncMock).toHaveBeenCalledWith(
      'ps -p 48217 -o lstart=',
      expect.objectContaining({
        encoding: 'utf-8',
        timeout: 2000,
        env: expect.objectContaining({ LC_TIME: 'C' }),
      }),
    );
  });
});

describe('scoped queue and observability reads', () => {
  beforeEach(() => {
    setCurrentActiveContextPackTaskScope({
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    });
  });

  afterEach(() => {
    setCurrentActiveContextPackTaskScope(null);
    vi.restoreAllMocks();
    execSyncMock.mockReset();
  });

  it('counts only active-pack visible queue markdown and active markers', async () => {
    const snapshot = await readQueueStatusSnapshot(scopedQueueFs());

    expect(snapshot).toEqual(expect.objectContaining({
      queueDepth: 1,
      pendingReviewCount: 1,
      activeTaskId: 'TASK-A',
      errorItemsCount: 1,
    }));
    expect(snapshot.message).toBe('Observed repo queue state: 1 queued, 1 pending. Active tasks: 1.');
  });

  it('includes only active-pack pending queue items and active task IDs', async () => {
    const snapshot = await readObservabilitySnapshot(scopedQueueFs());

    expect((snapshot.pendingQueueItems ?? []).map((item) => item.queueName)).toEqual(['TASK-A.md']);
    expect((snapshot.pendingQueueItems ?? [])[0]).toEqual(expect.objectContaining({
      taskId: 'TASK-A',
      state: 'active',
    }));
    expect(snapshot.activeTaskId).toBe('TASK-A');
    expect((snapshot.activeTasks ?? []).map((task) => task.taskId)).toEqual(['TASK-A']);
    expect(snapshot.queueDepth).toBe(1);
    expect(snapshot.pendingReviewCount).toBe(1);
  });

  it('does not read hidden task runtime sessions or guardrails from runtime overrides', async () => {
    const fsAdapter = scopedQueueFs();

    const snapshot = await readObservabilitySnapshot(fsAdapter, ['TASK-A', 'TASK-B']);

    expect((snapshot.agentTerminalSessions ?? []).map((session) => session.taskId)).toEqual(['TASK-A']);
    expect((snapshot.guardrails ?? []).map((guardrail) => guardrail.receiptPath)).toEqual([
      '.platform-state/runtime/tasks/TASK-A/guardrails/alice.json',
    ]);
    expect(fsAdapter.readdir).not.toHaveBeenCalledWith(expect.stringContaining('/TASK-B/role-sessions'));
    expect(fsAdapter.readdir).not.toHaveBeenCalledWith(expect.stringContaining('/TASK-B/guardrails'));
  });

  it('preserves unscoped direct-call behavior before the app lifecycle initializes scope', async () => {
    vi.resetModules();
    const { readObservabilitySnapshot: readFreshObservabilitySnapshot, readQueueStatusSnapshot: readFreshQueueStatusSnapshot } =
      await import('./repoObservability');
    const fsAdapter = unscopedQueueFs();

    await expect(readFreshQueueStatusSnapshot(fsAdapter)).resolves.toEqual(expect.objectContaining({
      queueDepth: 2,
      pendingReviewCount: 2,
      activeTaskId: 'TASK-A',
      errorItemsCount: 1,
    }));
    await expect(readFreshObservabilitySnapshot(fsAdapter)).resolves.toEqual(expect.objectContaining({
      queueDepth: 2,
      pendingReviewCount: 2,
      activeTaskId: 'TASK-A',
      pendingQueueItems: expect.arrayContaining([
        expect.objectContaining({ queueName: 'TASK-A.md' }),
        expect.objectContaining({ queueName: 'TASK-B.md' }),
      ]),
      activeTasks: expect.arrayContaining([
        expect.objectContaining({ taskId: 'TASK-A' }),
        expect.objectContaining({ taskId: 'TASK-B' }),
      ]),
    }));
  });
});

describe('role session receipt parsing', () => {
  beforeEach(() => {
    setCurrentActiveContextPackTaskScope({
      contextPackId: 'pack-a',
      contextPackDir: '/packs/pack-a',
      contextPackName: 'pack-a',
    });
  });

  afterEach(() => {
    setCurrentActiveContextPackTaskScope(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    execSyncMock.mockReset();
  });

  it('uses launch_id for runtime session identity and launch_phase for labels', async () => {
    const receipts: Record<string, string> = {
      'dalton-initial.json': JSON.stringify({
        agent_id: 'dalton',
        launch_id: 'initial-launch',
        role_name: 'Software Engineer',
        session_kind: 'task-role',
        launch: {
          status: 'started',
          started_at: '2026-05-04T20:16:17Z',
          pid: null,
        },
        latest_output_lines: ['Started Dalton runtime.'],
      }),
      'dalton-retry.json': JSON.stringify({
        agent_id: 'dalton',
        launch_id: 'retry-launch',
        launch_phase: 'Confinement retry',
        retry_of_launch_id: 'initial-launch',
        role_name: 'Software Engineer',
        session_kind: 'task-role',
        launch: {
          status: 'started',
          started_at: '2026-05-04T20:16:17Z',
          pid: null,
        },
        latest_output_lines: ['Started Dalton Confinement retry runtime.'],
      }),
    };
    const pendingMarkdown = [
      '# Task A',
      '',
      '## Task Metadata',
      '',
      '- Task ID: TASK-A',
      '',
      '## Context Pack Binding',
      '',
      '- Context Pack Dir: /packs/pack-a',
      '- Context Pack ID: pack-a',
      '- Scope Mode: focused',
    ].join('\n');
    const fsAdapter = {
      access: vi.fn(async (targetPath: string) => {
        if (
          targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions') ||
          targetPath.endsWith('AgentWorkSpace/pendingitems')
        ) {
          return;
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }),
      readdir: vi.fn(async (targetPath: string) => {
        if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
          return Object.keys(receipts);
        }
        if (targetPath.endsWith('AgentWorkSpace/pendingitems')) {
          return ['task-a.md'];
        }
        return [];
      }),
      readFile: vi.fn(async (targetPath: string) => {
        const filename = targetPath.split(/[\\/]/).at(-1) ?? '';
        if (filename === 'task-a.md') {
          return pendingMarkdown;
        }
        return receipts[filename] ?? '';
      }),
    };

    const snapshot = await readObservabilitySnapshot(fsAdapter, ['TASK-A']);
    const sessions = snapshot.agentTerminalSessions ?? [];

    expect(sessions.map((session) => session.sessionId).sort()).toEqual([
      'role:dalton:initial-launch',
      'role:dalton:retry-launch',
    ]);
    expect(sessions.find((session) =>
      session.sessionId === 'role:dalton:retry-launch',
    )).toEqual(expect.objectContaining({
      agentLabel: 'Dalton (Software Engineer) — Confinement retry',
      latestOutputLines: ['Started Dalton Confinement retry runtime.'],
    }));
  });

  it('marks an old non-final session with no monitor as orphaned when launch pid is gone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T05:36:41Z'));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' });
    });

    const snapshot = await readObservabilitySnapshot(
      fsWithRoleReceipt({
        agent_id: 'alice',
        launch_id: 'launch-1',
        launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: 11111 },
      }),
      ['TASK-A'],
    );

    expect(snapshot.agentTerminalSessions?.[0]).toMatchObject({
      liveness: 'not-found',
      stuckState: 'orphaned',
    });
  });

  it('keeps a non-final session unstuck when launch pid is gone but monitor is recent and live', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T05:36:41Z'));
    vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 22222) {
        return true;
      }
      throw Object.assign(new Error('missing'), { code: 'ESRCH' });
    });

    const snapshot = await readObservabilitySnapshot(
      fsWithRoleReceipt({
        agent_id: 'alice',
        launch_id: 'launch-1',
        launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: 11111 },
        monitor: {
          status: 'watching',
          pid: 22222,
          started_at: '2026-05-16T05:33:19Z',
          updated_at: '2026-05-16T05:36:20Z',
        },
      }),
      ['TASK-A'],
    );

    expect(snapshot.agentTerminalSessions?.[0]).toMatchObject({
      liveness: 'not-found',
      stuckState: 'none',
    });
  });

  it('keeps completed sessions unstuck regardless of launch pid', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T05:36:41Z'));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' });
    });

    const snapshot = await readObservabilitySnapshot(
      fsWithRoleReceipt({
        agent_id: 'alice',
        launch_id: 'launch-1',
        launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: 11111 },
        terminal: { status: 'completed', completed_at: '2026-05-16T05:39:01Z', exit_code: 0 },
      }),
      ['TASK-A'],
    );

    expect(snapshot.agentTerminalSessions?.[0]).toMatchObject({
      liveness: 'not-found',
      stuckState: 'none',
      terminalState: 'completed',
    });
  });

  it('parses older receipts with no monitor', async () => {
    const snapshot = await readObservabilitySnapshot(
      fsWithRoleReceipt({
        agent_id: 'alice',
        launch_id: 'launch-1',
        launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: null },
      }),
      ['TASK-A'],
    );

    expect(snapshot.agentTerminalSessions?.[0]).toMatchObject({
      sessionId: 'role:alice:launch-1',
      stuckState: 'none',
    });
  });

  it('marks a non-final session orphaned when recent monitor pid is dead', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T05:36:41Z'));
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ESRCH' });
    });

    const snapshot = await readObservabilitySnapshot(
      fsWithRoleReceipt({
        agent_id: 'alice',
        launch_id: 'launch-1',
        launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: 11111 },
        monitor: {
          status: 'watching',
          pid: 22222,
          started_at: '2026-05-16T05:33:19Z',
          updated_at: '2026-05-16T05:36:20Z',
        },
      }),
      ['TASK-A'],
    );

    expect(snapshot.agentTerminalSessions?.[0]).toMatchObject({
      liveness: 'not-found',
      stuckState: 'orphaned',
    });
  });
});

function bindingMarkdown(taskId: string, contextPackId: string): string {
  return [
    `# Task ${taskId}`,
    '',
    '## Task Metadata',
    '',
    `- Task ID: ${taskId}`,
    `- Task Title: Title ${taskId}`,
    '',
    '## Context Pack Binding',
    '',
    `- Context Pack Dir: /packs/${contextPackId}`,
    `- Context Pack ID: ${contextPackId}`,
    '- Scope Mode: focused',
  ].join('\n');
}

function scopedQueueFs() {
  return {
    access: vi.fn(async (targetPath: string) => {
      if (
        targetPath.endsWith('AgentWorkSpace/dropbox') ||
        targetPath.endsWith('AgentWorkSpace/pendingitems') ||
        targetPath.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
        targetPath.endsWith('AgentWorkSpace/error-items') ||
        targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions') ||
        targetPath.includes('.platform-state/runtime/tasks/TASK-A/guardrails')
      ) {
        return;
      }
      throw Object.assign(new Error(`missing ${targetPath}`), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith('AgentWorkSpace/dropbox')) {
        return ['OPEN-A.md', 'OPEN-B.md'];
      }
      if (targetPath.endsWith('AgentWorkSpace/pendingitems')) {
        return ['TASK-A.md', 'TASK-B.md'];
      }
      if (targetPath.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
        return ['TASK-A', 'TASK-B'];
      }
      if (targetPath.endsWith('AgentWorkSpace/error-items')) {
        return ['ERROR-A.md', 'ERROR-B.md'];
      }
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
        return ['alice.json'];
      }
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/guardrails')) {
        return ['alice.json'];
      }
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-B/')) {
        throw new Error(`hidden runtime path read: ${targetPath}`);
      }
      return [];
    }),
    readFile: vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith('OPEN-A.md')) return bindingMarkdown('OPEN-A', 'pack-a');
      if (targetPath.endsWith('OPEN-B.md')) return bindingMarkdown('OPEN-B', 'pack-b');
      if (targetPath.endsWith('TASK-A.md')) return bindingMarkdown('TASK-A', 'pack-a');
      if (targetPath.endsWith('TASK-B.md')) return bindingMarkdown('TASK-B', 'pack-b');
      if (targetPath.endsWith('ERROR-A.md')) return bindingMarkdown('ERROR-A', 'pack-a');
      if (targetPath.endsWith('ERROR-B.md')) return bindingMarkdown('ERROR-B', 'pack-b');
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions/alice.json')) {
        return JSON.stringify({
          agent_id: 'alice',
          launch_id: 'launch-a',
          role_name: 'Product Manager',
          launch: { status: 'started', started_at: '2026-05-16T05:33:19Z', pid: null },
          terminal: { status: 'completed', completed_at: '2026-05-16T05:39:01Z', exit_code: 0 },
        });
      }
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/guardrails/alice.json')) {
        return JSON.stringify({
          status: 'allowed',
          resolved_agent_id: 'alice',
          instance_id: 'launch-a',
          validator_mode: 'guarded',
        });
      }
      return '';
    }),
  };
}

function unscopedQueueFs() {
  return {
    access: vi.fn(async (targetPath: string) => {
      if (
        targetPath.endsWith('AgentWorkSpace/dropbox') ||
        targetPath.endsWith('AgentWorkSpace/pendingitems') ||
        targetPath.endsWith('AgentWorkSpace/pendingitems/.active-items') ||
        targetPath.endsWith('AgentWorkSpace/error-items')
      ) {
        return;
      }
      throw Object.assign(new Error(`missing ${targetPath}`), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith('AgentWorkSpace/dropbox')) {
        return ['OPEN-A.md', 'OPEN-B.md'];
      }
      if (targetPath.endsWith('AgentWorkSpace/pendingitems')) {
        return ['TASK-A.md', 'TASK-B.md'];
      }
      if (targetPath.endsWith('AgentWorkSpace/pendingitems/.active-items')) {
        return ['TASK-A', 'TASK-B'];
      }
      if (targetPath.endsWith('AgentWorkSpace/error-items')) {
        return ['ERROR-A.md'];
      }
      return [];
    }),
    readFile: vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith('TASK-A.md')) return '# Task A\n\n## Task Metadata\n\n- Task ID: TASK-A\n- Task Title: Title A\n';
      if (targetPath.endsWith('TASK-B.md')) return '# Task B\n\n## Task Metadata\n\n- Task ID: TASK-B\n- Task Title: Title B\n';
      return '';
    }),
  };
}

function fsWithRoleReceipt(receipt: Record<string, unknown>) {
  const receiptFile = 'alice-launch.json';
  const pendingFile = 'task-a.md';
  const pendingMarkdown = [
    '# Task A',
    '',
    '## Task Metadata',
    '',
    '- Task ID: TASK-A',
    '',
    '## Context Pack Binding',
    '',
    '- Context Pack Dir: /packs/pack-a',
    '- Context Pack ID: pack-a',
    '- Scope Mode: focused',
  ].join('\n');
  return {
    access: vi.fn(async (targetPath: string) => {
      if (
        targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions') ||
        targetPath.endsWith('AgentWorkSpace/pendingitems')
      ) {
        return;
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }),
    readdir: vi.fn(async (targetPath: string) => {
      if (targetPath.includes('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
        return [receiptFile];
      }
      if (targetPath.endsWith('AgentWorkSpace/pendingitems')) {
        return [pendingFile];
      }
      return [];
    }),
    readFile: vi.fn(async (targetPath: string) => {
      if (targetPath.endsWith(receiptFile)) {
        return JSON.stringify(receipt);
      }
      if (targetPath.endsWith(pendingFile)) {
        return pendingMarkdown;
      }
      return '';
    }),
  };
}
