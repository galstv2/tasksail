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
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return '# Errors\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/retrospective-input.md')) {
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
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return '# Errors\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: TASK-1\n- Task Title: Recover task\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/retrospective-input.md')) {
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
      readdir: vi.fn(async () => []),
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
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return '# Errors\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/role-sessions/qa.json')) {
          return roleReceiptPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/role-sessions')) {
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
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return '# Errors\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/role-sessions/software-engineer.json')) {
          return receiptPayload;
        }
        if (
          path.endsWith(
            '.platform-state/runtime/guardrails/software-engineer.json',
          )
        ) {
          return guardrailPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/role-sessions')) {
          return ['software-engineer.json'];
        }
        if (path.endsWith('.platform-state/runtime/guardrails')) {
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
              '.platform-state/runtime/guardrails/software-engineer.json',
          }),
        ]),
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:software-engineer:2026-03-07T21:07:29Z',
            guardrailStatus: 'internal-bypass',
            guardrailReceiptPath:
              '.platform-state/runtime/guardrails/software-engineer.json',
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
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return '# Errors\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-04\n- Task Title: Observe queue artifacts\n- Task Kind: implementation\n';
        }
        if (path.endsWith('AgentWorkSpace/handoffs/retrospective-input.md')) {
          return '# Retrospective\n';
        }
        if (path.endsWith('.platform-state/runtime/role-sessions/software-engineer.json')) {
          return receiptPayload;
        }
        if (
          path.endsWith(
            '.platform-state/runtime/guardrails/software-engineer.json',
          )
        ) {
          return guardrailPayload;
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('.platform-state/runtime/role-sessions')) {
          return ['software-engineer.json'];
        }
        if (path.endsWith('.platform-state/runtime/guardrails')) {
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
              '.platform-state/runtime/guardrails/software-engineer.json',
          }),
        ]),
        agentTerminalSessions: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'role:software-engineer:2026-03-07T21:07:29Z',
            guardrailStatus: 'allowed',
            guardrailReceiptPath:
              '.platform-state/runtime/guardrails/software-engineer.json',
          }),
        ]),
      }),
    );

    killSpy.mockRestore();
  });

  it('reports queued snapshots and empty artifact templates without inventing task details', async () => {
    const { readObservabilitySnapshot, readQueueStatusSnapshot } = await import('./main');

    const queuedFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('professional-task.md')) {
          return '   \n';
        }

        if (path.endsWith('errors.md')) {
          return '# Errors\n';
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
        message: expect.stringContaining('Observed repo queue state: 1 queued, 0 pending. Operator status: PENDING.'),
      }),
    );

    await expect(readObservabilitySnapshot(queuedFs)).resolves.toEqual(
      expect.objectContaining({
        currentState: 'queued',
        activeTaskTitle: null,
        artifactReferences: expect.arrayContaining([
          expect.objectContaining({
            path: 'AgentWorkSpace/handoffs/professional-task.md',
            status: 'empty',
            detail: 'Artifact template is present but does not yet contain task details.',
          }),
        ]),
      }),
    );
  });

});
