// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadURL = vi.fn(async () => undefined);
const loadFile = vi.fn(async () => undefined);
const show = vi.fn();
const once = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready-to-show') {
    callback();
  }
});

const browserWindowInstance = {
  loadFile,
  loadURL,
  once,
  show,
};

const BrowserWindowMock = vi.fn(() => browserWindowInstance) as unknown as {
  (): typeof browserWindowInstance;
  getAllWindows: ReturnType<typeof vi.fn>;
};
BrowserWindowMock.getAllWindows = vi.fn(() => []);

const appMock = {
  on: vi.fn(),
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

const dialogMock = {
  showOpenDialog: vi.fn(),
};

const ipcMainMock = {
  handle: vi.fn(),
};

vi.mock('../../../backend/platform/context-pack/focusedRepo.js', () => ({
  resolveFocusedRepoRoot: vi.fn(async () => ({
    primaryRepoId: 'test-repo',
    primaryRepoRoot: '/repos/test-repo',
    primaryFocusRelativePath: null,
    visibleRepoRoots: ['/repos/test-repo'],
    declaredRepoRoots: ['/repos/test-repo'],
    selectedRepoIds: ['test-repo'],
    selectedFocusIds: [],
    estateType: 'distributed-platform',
    authoritySource: 'manifest-primary',
  })),
  resolveSelectedPrimaryRepoRoot: vi.fn(async () => ({
    primaryRepoId: 'test-repo',
    primaryRepoRoot: '/repos/test-repo',
    primaryFocusRelativePath: null,
    visibleRepoRoots: ['/repos/test-repo'],
    declaredRepoRoots: ['/repos/test-repo'],
    selectedRepoIds: ['test-repo'],
    selectedFocusIds: [],
    estateType: 'distributed-platform',
    authoritySource: 'manifest-primary',
  })),
  collectFocusedRepoTargetDirectoryRoots: vi.fn(() => []),
}));

vi.mock('./main.staging', () => ({
  initializeStagedPlanningDraft: vi.fn(async () => undefined),
  clearStagingArtifacts: vi.fn(async () => undefined),
  readOwnedStagedDraft: vi.fn(async () => ({ draft: null, error: null, metadata: null })),
  readStagedDraft: vi.fn(async () => ({ draft: null, error: null })),
  derivePlannerDraftTitle: vi.fn(() => 'test-repo'),
}));

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

describe('electron main bootstrap — sessions and guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('includes planner broker telemetry in the observability snapshot', async () => {
    const { readObservabilitySnapshot } = await import('./main');
    const plannerSession = await import('./plannerSession');

    plannerSession.endSession();
    const { sessionId } = await plannerSession.startSession('/contextpacks/test');

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n';
        }
        if (path.includes('/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        return '# Placeholder\n';
      }),
      readdir: vi.fn(async () => []),
    };

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        plannerBroker: expect.objectContaining({
          sessionId,
          brokerStatus: 'idle',
          lastTurnSource: 'none',
          lastTurnOutcome: 'idle',
          turnCount: 0,
        }),
      }),
    );

    plannerSession.endSession();
  });

  it('surfaces persisted recovery state in the observability snapshot', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: TASK-1\n- Task Title: Recover task\n';
        }
        if (path.includes('/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/desktop-recovery-state.json')) {
          return JSON.stringify({
            schemaVersion: 1,
            state: {
              kind: 'activation-timeout',
              status: 'pending-start',
              summary: 'Waiting for pipeline activity for TASK-1.md.',
              queueName: 'TASK-1.md',
              taskId: 'TASK-1',
              activationStartedAt: '2026-03-28T23:00:00Z',
              deadlineAt: '2026-03-28T23:05:00Z',
              detectedAt: '2026-03-28T23:00:00Z',
              updatedAt: '2026-03-28T23:00:00Z',
              errorItemPath: null,
            },
          });
        }
        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        // Active marker: taskId as filename in .active-items/.
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-1'];
        }
        return [];
      }),
    };

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        recoveryState: expect.objectContaining({
          status: 'pending-start',
          queueName: 'TASK-1.md',
        }),
        activeTask: expect.objectContaining({
          recoveryState: expect.objectContaining({
            status: 'pending-start',
            kind: 'activation-timeout',
          }),
        }),
      }),
    );
  });

  it('maps non-dalton task-scoped runtime receipts into observed terminal sessions', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const roleReceiptPayload = JSON.stringify({
      task_id: 'CAP-CUSTOM-TERMINAL-04',
      task_title: 'Observe queue artifacts',
      agent_id: 'qa',
      role_name: 'QA and Closeout',
      session_kind: 'task-role',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:07:29Z',
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:09:00Z',
        exit_code: 0,
      },
        latest_output_lines: ['QA and Closeout exited completed (exit_code=0).'],
    });

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.includes('/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions/qa.json')) {
          return roleReceiptPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['CAP-CUSTOM-TERMINAL-04'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions')) {
          return ['qa.json'];
        }
        return [];
      }),
    };

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:qa:2026-03-07T21:07:29Z',
            taskId: 'CAP-CUSTOM-TERMINAL-04',
            agentId: 'qa',
            instanceId: null,
            sliceId: null,
            launchPid: null,
            terminalState: 'completed',
          }),
        ]),
      }),
    );
  });

  it('aggregates guardrail receipts into summary and session observability', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const receiptPayload = JSON.stringify({
      task_id: 'CAP-CUSTOM-TERMINAL-04',
      task_title: 'Observe queue artifacts',
      agent_id: 'software-engineer',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:07:29Z',
        pid: 48217,
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:09:00Z',
        exit_code: 0,
      },
    });
    const guardrailPayload = JSON.stringify({
      schema_version: 1,
      receipt_kind: 'guardrail',
      status: 'internal-bypass',
      requested_agent_id: 'software-engineer',
      resolved_agent_id: 'software-engineer',
      expected_agent_id: 'software-engineer',
      validator_mode: 'runtime',
      launch_seam: 'src/backend/platform/agent-runner/roleAgent.ts',
      required_model: 'gpt-5.4',
      active_model: 'gpt-5.4',
      violations: [],
    });

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.includes('/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions/software-engineer.json')) {
          return receiptPayload;
        }
        if (
          path.endsWith(
            '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          )
        ) {
          return guardrailPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        // Active marker: taskId as filename in .active-items/.
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['CAP-CUSTOM-TERMINAL-04'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions')) {
          return ['software-engineer.json'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails')) {
          return ['software-engineer.json'];
        }
        return [];
      }),
    };

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        guardrailSummary: expect.objectContaining({
          status: 'attention',
          internalBypassCount: 1,
          observedReceiptCount: 1,
        }),
        activeTask: expect.objectContaining({
          guardrailSummary: expect.objectContaining({
            status: 'attention',
          }),
        }),
        guardrails: expect.arrayContaining([
          expect.objectContaining({
            status: 'internal-bypass',
            receiptPath:
              '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          }),
        ]),
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:software-engineer:2026-03-07T21:07:29Z',
            guardrailStatus: 'internal-bypass',
            guardrailReceiptPath:
              '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          }),
        ]),
      }),
    );

    killSpy.mockRestore();
  });

  it('maps passed guardrail receipts into allowed observability status', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const receiptPayload = JSON.stringify({
      task_id: 'CAP-CUSTOM-TERMINAL-04',
      task_title: 'Observe queue artifacts',
      agent_id: 'software-engineer',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:07:29Z',
        pid: 48217,
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:09:00Z',
        exit_code: 0,
      },
    });
    const guardrailPayload = JSON.stringify({
      schema_version: 1,
      receipt_kind: 'guardrail',
      status: 'passed',
      requested_agent_id: 'software-engineer',
      resolved_agent_id: 'software-engineer',
      expected_agent_id: 'software-engineer',
      validator_mode: 'runtime',
      launch_seam: 'src/backend/platform/agent-runner/roleAgent.ts',
      required_model: 'gpt-5.4',
      active_model: 'gpt-5.4',
      violations: [],
    });

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.includes('/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.includes('/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions/software-engineer.json')) {
          return receiptPayload;
        }
        if (
          path.endsWith(
            '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          )
        ) {
          return guardrailPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        // Active marker: taskId as filename in .active-items/.
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['CAP-CUSTOM-TERMINAL-04'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/role-sessions')) {
          return ['software-engineer.json'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails')) {
          return ['software-engineer.json'];
        }
        return [];
      }),
    };

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        guardrailSummary: expect.objectContaining({
          status: 'healthy',
          allowedCount: 1,
          observedReceiptCount: 1,
        }),
        activeTask: expect.objectContaining({
          guardrailSummary: expect.objectContaining({
            status: 'healthy',
            allowedCount: 1,
          }),
        }),
        guardrails: expect.arrayContaining([
          expect.objectContaining({
            status: 'allowed',
            receiptPath:
              '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          }),
        ]),
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:software-engineer:2026-03-07T21:07:29Z',
            guardrailStatus: 'allowed',
            guardrailReceiptPath:
              '.platform-state/runtime/tasks/CAP-CUSTOM-TERMINAL-04/guardrails/software-engineer.json',
          }),
        ]),
      }),
    );

    killSpy.mockRestore();
  });

  it('injects taskId from per-task runtime receipt directory when payload omits task_id', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const receiptPayload = JSON.stringify({
      agent_id: 'qa',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:07:29Z',
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:09:00Z',
        exit_code: 0,
      },
    });

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions/qa-1.json')) {
          return receiptPayload;
        }
        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
          return ['qa-1.json'];
        }
        return [];
      }),
    };

    await expect(readObservabilitySnapshot(receiptFs)).resolves.toEqual(
      expect.objectContaining({
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:qa:2026-03-07T21:07:29Z',
            taskId: 'TASK-A',
          }),
        ]),
      }),
    );
  });

  it('ignores legacy same-launch session_history entries to avoid duplicate terminal sessions', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const receiptPayload = JSON.stringify({
      agent_id: 'dalton',
      launch_id: '1777258826099-97600',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:09:00Z',
        pid: 1933,
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:10:00Z',
        exit_code: 0,
      },
      session_history: [
        {
          agent_id: 'dalton',
          launch_id: '1777258826099-97600',
          launch: {
            status: 'started',
            started_at: '2026-03-07T21:07:00Z',
            pid: 987,
          },
          terminal: {
            status: 'completed',
            completed_at: '2026-03-07T21:08:00Z',
            exit_code: 0,
          },
        },
      ],
    });

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions/dalton-1.json')) {
          return receiptPayload;
        }
        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A'];
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions')) {
          return ['dalton-1.json'];
        }
        return [];
      }),
    };

    const snapshot = await readObservabilitySnapshot(receiptFs);
    const daltonSessions = (snapshot.agentTerminalSessions ?? []).filter(
      (session) => session.agentId === 'dalton',
    );

    expect(daltonSessions).toHaveLength(1);
    expect(daltonSessions[0]).toEqual(expect.objectContaining({
      sessionId: 'role:dalton:2026-03-07T21:09:00Z',
      launchPid: 1933,
      taskId: 'TASK-A',
    }));
  });

  it('keeps guardrail merges scoped to sessions from the same task runtime directory', async () => {
    const { readObservabilitySnapshot } = await import('./main');

    const taskAReceiptPayload = JSON.stringify({
      agent_id: 'software-engineer',
      launch: {
        status: 'started',
        started_at: '2026-03-07T21:07:29Z',
        pid: 48217,
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T21:09:00Z',
        exit_code: 0,
      },
    });
    const taskBReceiptPayload = JSON.stringify({
      agent_id: 'software-engineer',
      launch: {
        status: 'started',
        started_at: '2026-03-07T22:07:29Z',
        pid: 48218,
      },
      terminal: {
        status: 'completed',
        completed_at: '2026-03-07T22:09:00Z',
        exit_code: 0,
      },
    });
    const taskAGuardrailPayload = JSON.stringify({
      schema_version: 1,
      receipt_kind: 'guardrail',
      status: 'internal-bypass',
      requested_agent_id: 'software-engineer',
      resolved_agent_id: 'software-engineer',
      expected_agent_id: 'software-engineer',
      validator_mode: 'runtime',
      launch_seam: 'task-a-seam',
      required_model: 'gpt-5.4',
      active_model: 'gpt-5.4',
      violations: [],
    });
    const taskBGuardrailPayload = JSON.stringify({
      schema_version: 1,
      receipt_kind: 'guardrail',
      status: 'passed',
      requested_agent_id: 'software-engineer',
      resolved_agent_id: 'software-engineer',
      expected_agent_id: 'software-engineer',
      validator_mode: 'runtime',
      required_model: 'gpt-5.4',
      active_model: 'gpt-5.4',
      violations: [],
    });
    const taskAGuardrailPath = '.platform-state/runtime/tasks/TASK-A/guardrails/software-engineer.json';
    const taskBGuardrailPath = '.platform-state/runtime/tasks/TASK-B/guardrails/software-engineer.json';

    const receiptFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions/software-engineer.json')) {
          return taskAReceiptPayload;
        }
        if (path.endsWith('.platform-state/runtime/tasks/TASK-B/role-sessions/software-engineer.json')) {
          return taskBReceiptPayload;
        }
        if (path.endsWith(taskAGuardrailPath)) {
          return taskAGuardrailPayload;
        }
        if (path.endsWith(taskBGuardrailPath)) {
          return taskBGuardrailPayload;
        }
        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/pendingitems/.active-items')) {
          return ['TASK-A', 'TASK-B'];
        }
        if (
          path.endsWith('.platform-state/runtime/tasks/TASK-A/role-sessions') ||
          path.endsWith('.platform-state/runtime/tasks/TASK-B/role-sessions')
        ) {
          return ['software-engineer.json'];
        }
        if (
          path.endsWith('.platform-state/runtime/tasks/TASK-A/guardrails') ||
          path.endsWith('.platform-state/runtime/tasks/TASK-B/guardrails')
        ) {
          return ['software-engineer.json'];
        }
        return [];
      }),
    };

    const snapshot = await readObservabilitySnapshot(receiptFs);
    const sessions = snapshot.agentTerminalSessions ?? [];
    const taskASession = sessions.find((session) => session.taskId === 'TASK-A');
    const taskBSession = sessions.find((session) => session.taskId === 'TASK-B');

    expect(taskASession).toEqual(expect.objectContaining({
      guardrailStatus: 'internal-bypass',
      guardrailReceiptPath: taskAGuardrailPath,
    }));
    expect(taskBSession).toEqual(expect.objectContaining({
      guardrailStatus: 'allowed',
      guardrailReceiptPath: taskBGuardrailPath,
    }));
    expect(taskASession?.guardrailReceiptPath).not.toBe(taskBGuardrailPath);
    expect(taskBSession?.guardrailReceiptPath).not.toBe(taskAGuardrailPath);
  });

  it('reports queued snapshots and empty artifact templates without inventing task details', async () => {
    const { readObservabilitySnapshot, readQueueStatusSnapshot } = await import('./main');

    const queuedFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('professional-task.md')) {
          return '   \n';
        }

        return '';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/dropbox')) {
          return ['queued.md', '.gitkeep'];
        }

        return [];
      }),
    };

    await expect(readQueueStatusSnapshot(queuedFs)).resolves.toEqual(
      expect.objectContaining({
        queueDepth: 1,
        pendingReviewCount: 0,
        activeTaskId: null,
        message: expect.stringContaining('Observed repo queue state: 1 queued, 0 pending. Active tasks: 0.'),
      }),
    );

    await expect(readObservabilitySnapshot(queuedFs)).resolves.toEqual(
      expect.objectContaining({
        currentState: 'queued',
        activeTaskTitle: null,
        // No active tasks — per-task artifact references are empty.
        artifactReferences: [],
      }),
    );
  });

  it('§7.0C OperatorStatus shape lock: operatorStatus is an object with activeTasks array and activeTaskId scalar', async () => {
    // §5.5 F28: OperatorStatus changed from string enum to { activeTasks, activeTaskId }.
    // This test locks the shape so regressions in the contract are caught immediately.
    const { readQueueStatusSnapshot } = await import('./main');

    const idleFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async () => ''),
      readdir: vi.fn(async () => [] as string[]),
    };

    const snapshot = await readQueueStatusSnapshot(idleFs);
    const { operatorStatus } = snapshot;

    // operatorStatus must be an object (not a string).
    expect(typeof operatorStatus).toBe('object');
    expect(operatorStatus).not.toBeNull();

    // activeTasks must be an array.
    expect(Array.isArray(operatorStatus?.activeTasks)).toBe(true);

    // activeTaskId must be null when no tasks are active.
    expect(operatorStatus?.activeTaskId).toBeNull();

    // No legacy string values ('OPEN', 'RUNNING', 'PENDING') should appear.
    expect(operatorStatus).not.toBe('OPEN');
    expect(operatorStatus).not.toBe('RUNNING');
    expect(operatorStatus).not.toBe('PENDING');
  });

});
