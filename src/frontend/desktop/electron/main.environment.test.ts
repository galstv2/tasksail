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

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

describe('electron main bootstrap — environment and observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    BrowserWindowMock.getAllWindows.mockReturnValue([]);
    dialogMock.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/selected-directory'],
    });
  });

  it('builds read-only queue and artifact observability snapshots from repo artifacts', async () => {
    const {
      getPackageArtifactName,
      getPackageCommand,
      readEnvironmentStatus,
      readObservabilitySnapshot,
      readQueueStatusSnapshot,
    } = await import('./main');

    const readOnlyFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('professional-task.md')) {
          return '# Professional Task\n\n- Task ID: CAP-CUSTOM-TERMINAL-06\n- Task Title: Observe queue artifacts\n';
        }

        if (path.endsWith('errors.md')) {
          return '# Errors\n';
        }

        return '# Summary\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/dropbox')) {
          return ['20260307T-task.md'];
        }

        if (path.endsWith('/AgentWorkSpace/pendingitems')) {
          return ['20260307T-active.md'];
        }

        if (path.endsWith('/AgentWorkSpace/ImplementationSteps')) {
          return ['slice-11-pilot-request-id-propagation.md'];
        }

        return [];
      }),
      writeFile: vi.fn(),
    };

    await expect(readQueueStatusSnapshot(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'queue.readStatus',
        mode: 'observed',
        queueDepth: 1,
        pendingReviewCount: 1,
        activeTaskId: 'CAP-CUSTOM-TERMINAL-06',
      }),
    );

    await expect(readObservabilitySnapshot(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'observability.readSnapshot',
        mode: 'read-only',
        currentState: 'active',
        activeTaskTitle: 'Observe queue artifacts',
        activeTask: expect.objectContaining({
          taskId: 'CAP-CUSTOM-TERMINAL-06',
          taskTitle: 'Observe queue artifacts',
          workflowStage: 'active',
          taskHealth: expect.objectContaining({
            status: 'idle',
            observedSessionCount: 0,
          }),
        }),
        agentTerminalSessions: [],
        artifactReferences: expect.arrayContaining([
          expect.objectContaining({ path: 'AgentWorkSpace/handoffs/professional-task.md', status: 'present' }),
          expect.objectContaining({ path: 'AgentWorkSpace/handoffs/retrospective-input.md', status: 'present' }),
          expect.objectContaining({ path: 'AgentWorkSpace/ImplementationSteps', kind: 'directory' }),
        ]),
      }),
    );

    await expect(readEnvironmentStatus(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'environment.readStatus',
        packageCommand: getPackageCommand(),
        packageArtifactName: getPackageArtifactName(),
        helperStatuses: expect.arrayContaining([
          expect.objectContaining({ path: 'src/backend/platform/queue/createDropboxTask.ts', available: true }),
          expect.objectContaining({ path: 'src/backend/platform/queue/createFollowupTask.ts', available: true }),
          expect.objectContaining({ path: 'src/backend/platform/context-pack/switch.ts', available: true }),
        ]),
      }),
    );

    expect(readOnlyFs.writeFile).not.toHaveBeenCalled();
  });

  it('treats historical summaries without current task metadata as idle state', async () => {
    const { readObservabilitySnapshot, readQueueStatusSnapshot } = await import('./main');

    const readOnlyFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('professional-task.md')) {
          return '# Professional Task\n\n- Task ID:\n- Task Title:\n';
        }

        if (path.endsWith('errors.md')) {
          return '# Errors\n';
        }

        return '# Summary\n';
      }),
      readdir: vi.fn(async (path: string) => {
        if (path.endsWith('/AgentWorkSpace/dropbox')) {
          return [];
        }

        if (path.endsWith('/AgentWorkSpace/pendingitems')) {
          return [];
        }

        if (path.endsWith('/AgentWorkSpace/ImplementationSteps')) {
          return ['slice-11-pilot-request-id-propagation.md'];
        }

        return [];
      }),
      writeFile: vi.fn(),
    };

    await expect(readQueueStatusSnapshot(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'queue.readStatus',
        activeTaskId: null,
        queueDepth: 0,
        pendingReviewCount: 0,
        message: 'Observed repo queue state: 0 queued, 0 pending. Operator status: OPEN.',
      }),
    );

    await expect(readObservabilitySnapshot(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'observability.readSnapshot',
        currentState: 'idle',
        activeTaskId: null,
        activeTaskTitle: null,
      }),
    );
  });

  it('reports platform module helper seams in environment status without inventing fallback paths', async () => {
    const { readEnvironmentStatus } = await import('./main');

    const readOnlyFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async () => '# unused\n'),
      readdir: vi.fn(async () => []),
    };

    await expect(readEnvironmentStatus(readOnlyFs)).resolves.toEqual(
      expect.objectContaining({
        action: 'environment.readStatus',
        helperStatuses: expect.arrayContaining([
          expect.objectContaining({ path: 'src/backend/platform/queue/createDropboxTask.ts', available: true }),
          expect.objectContaining({ path: 'src/backend/platform/queue/createFollowupTask.ts', available: true }),
          expect.objectContaining({ path: 'src/backend/platform/context-pack/switch.ts', available: true }),
        ]),
      }),
    );
  });

  it('derives idle and blocked observability states from missing or populated artifacts', async () => {
    const { readObservabilitySnapshot, readQueueStatusSnapshot } = await import('./main');

    const blockedFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('errors.md')) {
          return '# Errors\n\nBlocker is active.\n';
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async () => []),
    };

    await expect(readObservabilitySnapshot(blockedFs)).resolves.toEqual(
      expect.objectContaining({
        currentState: 'blocked',
        lifecycle: expect.arrayContaining([
          expect.objectContaining({ state: 'blocked', observed: true }),
        ]),
        agentTerminalSessions: [],
      }),
    );

    const scaffoldFs = {
      access: vi.fn(async () => undefined),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('AgentWorkSpace/handoffs/errors.md')) {
          return [
            '# Errors',
            '',
            '## Task Metadata',
            '',
            '- Task ID:',
            '- Task Title:',
            '- Initialized At (UTC):',
            '- Active Branch:',
            '- Intake Source:',
            '',
            '## Failing Scenario',
            '',
            '## Reproduction Steps',
            '',
            '## Output or Stack Trace',
            '',
            '## Likely Owner',
            '',
            '## Remediation Owner Agent ID',
            '',
            '## Severity',
            '',
            '## Return-To Agent ID',
            '',
            '## Notes',
            '',
          ].join('\n');
        }

        return '# Placeholder\n';
      }),
      readdir: vi.fn(async () => []),
    };

    await expect(readObservabilitySnapshot(scaffoldFs)).resolves.toEqual(
      expect.objectContaining({
        currentState: 'idle',
        lifecycle: expect.arrayContaining([
          expect.objectContaining({ state: 'blocked', observed: false }),
        ]),
      }),
    );

    const idleFs = {
      access: vi.fn(async () => {
        throw new Error('missing');
      }),
      readFile: vi.fn(async () => '# Placeholder\n'),
      readdir: vi.fn(async () => []),
    };

    await expect(readQueueStatusSnapshot(idleFs)).resolves.toEqual(
      expect.objectContaining({
        queueDepth: 0,
        pendingReviewCount: 0,
        activeTaskId: null,
      }),
    );
    await expect(readObservabilitySnapshot(idleFs)).resolves.toEqual(
      expect.objectContaining({
        currentState: 'idle',
        artifactReferences: expect.arrayContaining([
          expect.objectContaining({ status: 'missing' }),
        ]),
      }),
    );
  });

});
