// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  const onceFn = vi.fn((event: string, callback: () => void) => {
    if (event === 'ready-to-show') callback();
  });
  const BW = vi.fn(() => ({
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    once: onceFn,
    show: vi.fn(),
  })) as unknown as { (): unknown; getAllWindows: ReturnType<typeof vi.fn> };
  BW.getAllWindows = vi.fn(() => []);
  return {
    app: { on: vi.fn(), quit: vi.fn(), whenReady: vi.fn(() => Promise.resolve()) },
    BrowserWindow: BW,
    dialog: { showOpenDialog: vi.fn() },
    ipcMain: { handle: vi.fn() },
    nativeImage: {
      createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
    },
  };
});

vi.mock('../../../backend/platform/agent-runner/reinforcementWrite', () => ({
  submitReinforcementFeedback: vi.fn(),
  updateGlobalRealignmentDoc: vi.fn(),
  checkActiveWorkGuard: vi.fn(),
  startRealignmentSession: vi.fn(),
  dismissRealignmentSession: vi.fn(),
}));

vi.mock('../../../backend/platform/agent-runner/reinforcementRead', () => ({
  readReinforcementOverview: vi.fn(),
  readAgentRewards: vi.fn(),
  listReinforcementTasks: vi.fn(),
  listRealignmentSessions: vi.fn(),
  readGlobalRealignmentDoc: vi.fn(),
}));

vi.mock('../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache', () => ({
  prewarmExternalMcpRegistry: vi.fn(),
}));

vi.mock('../../../backend/platform/agent-runner/realignmentPhase/supervisor', () => ({
  startRealignmentAnalysisJob: vi.fn(),
}));

import { handleDesktopAction } from './main';
import {
  submitReinforcementFeedback,
  updateGlobalRealignmentDoc,
  checkActiveWorkGuard,
  startRealignmentSession,
  dismissRealignmentSession,
} from '../../../backend/platform/agent-runner/reinforcementWrite';
import {
  readReinforcementOverview,
  readAgentRewards,
  listReinforcementTasks,
  listRealignmentSessions,
  readGlobalRealignmentDoc,
} from '../../../backend/platform/agent-runner/reinforcementRead';
import { prewarmExternalMcpRegistry } from '../../../backend/platform/agent-runner/pipeline/externalMcpRegistryCache';
import { startRealignmentAnalysisJob } from '../../../backend/platform/agent-runner/realignmentPhase/supervisor';

const mockSubmit = vi.mocked(submitReinforcementFeedback);
const mockUpdate = vi.mocked(updateGlobalRealignmentDoc);
const mockCheckGuard = vi.mocked(checkActiveWorkGuard);
const mockStartRealignment = vi.mocked(startRealignmentSession);
const mockDismissRealignment = vi.mocked(dismissRealignmentSession);
const mockReadOverview = vi.mocked(readReinforcementOverview);
const mockReadAgentRewards = vi.mocked(readAgentRewards);
const mockListTasks = vi.mocked(listReinforcementTasks);
const mockListSessions = vi.mocked(listRealignmentSessions);
const mockReadDoc = vi.mocked(readGlobalRealignmentDoc);
const mockPrewarmExternalMcpRegistry = vi.mocked(prewarmExternalMcpRegistry);
const mockStartRealignmentAnalysisJob = vi.mocked(startRealignmentAnalysisJob);

describe('reinforcement IPC actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrewarmExternalMcpRegistry.mockResolvedValue({
      schema_version: 1,
      external_servers: [],
    });
  });

  describe('reinforcement.submitFeedback', () => {
    const validPayload = {
      contextPackDir: '/tmp/context-pack',
      taskId: 'TASK-001',
      feedbackType: 'positive' as const,
      starRating: 4,
      comment: 'Good work',
    };

    it('dispatches to handler and returns success response', async () => {
      mockSubmit.mockResolvedValue({
        passed: true,
        stdout: '{"status":"ok"}',
        stderr: '',
        exitCode: 0,
        data: { status: 'ok' },
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.submitFeedback',
        payload: validPayload,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.submitFeedback',
            mode: 'submitted',
            passed: true,
            message: 'Reinforcement feedback submitted.',
            data: { status: 'ok' },
          }),
        );
      }
    });

    it('returns error when submission fails', async () => {
      mockSubmit.mockResolvedValue({
        passed: false,
        stdout: '',
        stderr: 'Script error',
        exitCode: 1,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.submitFeedback',
        payload: validPayload,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Script error');
        expect(result.action).toBe('reinforcement.submitFeedback');
      }
    });

    it('returns error when submission throws before script execution', async () => {
      mockSubmit.mockRejectedValue(new Error('No active context pack is configured.'));

      const result = await handleDesktopAction({
        action: 'reinforcement.submitFeedback',
        payload: validPayload,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('No active context pack is configured.');
        expect(result.action).toBe('reinforcement.submitFeedback');
      }
    });
  });

  describe('reinforcement.updateRealignmentDoc', () => {
    it('handles field/value mode', async () => {
      mockUpdate.mockResolvedValue({
        passed: true,
        stdout: '{"updated":true}',
        stderr: '',
        exitCode: 0,
        data: { updated: true },
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          field: 'velocity',
          value: 'high',
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.updateRealignmentDoc',
            mode: 'updated',
            passed: true,
          }),
        );
      }
      expect(mockUpdate).toHaveBeenCalledWith({
        contextPackDir: '/tmp/context-pack',
        field: 'velocity',
        value: 'high',
      });
    });

    it('handles bulk updates mode', async () => {
      mockUpdate.mockResolvedValue({
        passed: true,
        stdout: '{}',
        stderr: '',
        exitCode: 0,
        data: {},
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          updates: { velocity: 'high', quality: 'good' },
        },
      });

      expect(result.ok).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith({
        contextPackDir: '/tmp/context-pack',
        updates: { velocity: 'high', quality: 'good' },
      });
    });

    it('returns error when update fails', async () => {
      mockUpdate.mockResolvedValue({
        passed: false,
        stdout: '',
        stderr: 'Update failed',
        exitCode: 1,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          field: 'velocity',
          value: 'high',
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('Update failed');
      }
    });

    it('returns errorCode for version conflict', async () => {
      mockUpdate.mockResolvedValue({
        passed: false,
        stdout: '',
        stderr: '{"error": "version_conflict", "message": "Version conflict: expected 2, but document is at version 4."}',
        exitCode: 1,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          field: 'velocity',
          value: 'high',
        },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('version_conflict');
        expect(result.error).toBe('Version conflict: expected 2, but document is at version 4.');
      }
    });
  });

  describe('reinforcement.listTasks', () => {
    it('returns task list from context-pack archive', async () => {
      mockListTasks.mockResolvedValue({
        tasks: [
          {
            taskId: 'T-1',
            title: 'Test task',
            difficulty: 'medium',
            effectiveReward: 2000,
            settlementStatus: 'unrewarded',
            qualityOutcome: 'success',
            year: '2026',
            reviewStatus: 'unreviewed',
            feedbackCount: 0,
            archivePath: '/tmp/context-pack/qmd/context-packs/test/archive/tasks/2026/T-1/archive.md',
            archiveMarkdown: '# Test task\n',
          },
        ],
        availableYears: ['2026'],
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.listTasks',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.listTasks',
            mode: 'read-only',
          }),
        );
      }
    });
  });

  describe('reinforcement.readOverview', () => {
    it('returns overview data', async () => {
      mockReadOverview.mockResolvedValue({
        totalTasks: 5,
        totalReward: 10000,
        unrewardedCount: 2,
        streakProgress: 2,
        streakThreshold: 10,
        lastSettlementId: 'S-1',
        agents: [],
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.readOverview',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.readOverview',
            mode: 'read-only',
            overview: expect.objectContaining({
              totalTasks: 5,
              streakProgress: 2,
            }),
          }),
        );
      }
    });
  });

  describe('reinforcement.readAgentRewards', () => {
    it('returns per-agent reward data', async () => {
      mockReadAgentRewards.mockResolvedValue([
        {
          agentId: 'provider-builder',
          role: 'Software Engineer',
          multiplier: 1.5,
          lifetimeReward: 5000,
          unrewardedTaskCount: 0,
          unrewardedRewardTotal: 0,
        },
      ]);

      const result = await handleDesktopAction({
        action: 'reinforcement.readAgentRewards',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.readAgentRewards',
            agents: expect.arrayContaining([
              expect.objectContaining({ agentId: 'provider-builder' }),
            ]),
          }),
        );
      }
    });
  });

  describe('reinforcement.listRealignmentSessions', () => {
    it('returns session list', async () => {
      mockListSessions.mockResolvedValue([]);

      const result = await handleDesktopAction({
        action: 'reinforcement.listRealignmentSessions',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.listRealignmentSessions',
            sessions: [],
          }),
        );
      }
    });
  });

  describe('reinforcement.readRealignmentDoc', () => {
    it('returns the global realignment document', async () => {
      mockReadDoc.mockResolvedValue({
        standingExpectations: ['Be precise'],
        version: 1,
        updatedAt: '2026-03-22T00:00:00Z',
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.readRealignmentDoc',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.readRealignmentDoc',
            document: expect.objectContaining({
              standingExpectations: ['Be precise'],
              version: 1,
            }),
          }),
        );
      }
    });
  });

  describe('reinforcement.checkActiveWorkGuard', () => {
    it('returns allowed when no active work', async () => {
      mockCheckGuard.mockResolvedValue({
        allowed: true,
        activeTaskId: null,
        message: 'No active work.',
        hasUnprocessedFeedback: false,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.checkActiveWorkGuard',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.checkActiveWorkGuard',
            mode: 'guard-check',
            allowed: true,
          }),
        );
      }
    });

    it('returns blocked with errorCode when active work exists', async () => {
      mockCheckGuard.mockResolvedValue({
        allowed: false,
        activeTaskId: 'T-1',
        message: 'Blocked.',
        hasUnprocessedFeedback: false,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.checkActiveWorkGuard',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('active_work_blocked');
      }
    });
  });

  describe('reinforcement.startRealignment', () => {
    it('starts session when allowed', async () => {
      mockStartRealignment.mockResolvedValue({
        passed: true,
        stdout: '{"realignmentId":"RA-1"}',
        stderr: '',
        exitCode: 0,
        data: { realignmentId: 'RA-1' },
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.startRealignment',
        payload: { contextPackDir: '/ctx', triggerTaskId: 'T-1' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.response).toEqual(
          expect.objectContaining({
            action: 'reinforcement.startRealignment',
            mode: 'started',
          }),
        );
      }
    });

    it('returns active_work_blocked errorCode when blocked', async () => {
      mockStartRealignment.mockResolvedValue({
        passed: false,
        stdout: '',
        stderr: '{"error":"active_work_blocked","message":"Blocked."}',
        exitCode: 1,
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.startRealignment',
        payload: { contextPackDir: '/ctx', triggerTaskId: 'T-1' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('active_work_blocked');
      }
    });
  });

  describe('reinforcement.runRealignmentAnalysis', () => {
    it('loads and forwards the external MCP registry to the supervisor job', async () => {
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
      mockStartRealignmentAnalysisJob.mockResolvedValue({
        jobId: 'realignment:RA-1',
        realignmentId: 'RA-1',
        status: 'started',
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.runRealignmentAnalysis',
        payload: { contextPackDir: '/ctx', realignmentId: 'RA-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockStartRealignmentAnalysisJob).toHaveBeenCalledWith(expect.objectContaining({
        contextPackDir: '/ctx',
        realignmentId: 'RA-1',
        externalMcpRegistry,
      }));
    });
  });

  describe('reinforcement.dismissRealignment', () => {
    it('dismisses a realignment session', async () => {
      mockDismissRealignment.mockResolvedValue({
        passed: true,
        stdout: '{"status":"dismissed","realignment_id":"RA-1"}',
        stderr: '',
        exitCode: 0,
        data: { status: 'dismissed', realignment_id: 'RA-1' },
      });

      const result = await handleDesktopAction({
        action: 'reinforcement.dismissRealignment',
        payload: { contextPackDir: '/ctx', realignmentId: 'RA-1' },
      });

      expect(result.ok).toBe(true);
      expect(mockDismissRealignment).toHaveBeenCalledWith({
        contextPackDir: '/ctx',
        realignmentId: 'RA-1',
      });
      if (result.ok) {
        expect(result.response).toEqual(expect.objectContaining({
          action: 'reinforcement.dismissRealignment',
          mode: 'dismissed',
          realignmentId: 'RA-1',
        }));
      }
    });
  });
});
