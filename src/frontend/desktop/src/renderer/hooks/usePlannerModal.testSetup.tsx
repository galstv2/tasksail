import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import type {
  ArchivedTaskEntry,
  PlannerFocusSnapshot,
  PlannerListConversationHistorySummary,
  PlannerStartSessionDeepFocusSelection,
  PlannerStreamEvent,
} from '../../shared/desktopContract';
import type { PlannerConversationRecord } from '../../../../../backend/platform/planner-history/types.js';
import {
  createMockClient,
  createPlannerSubmitResponse,
} from '../../test';
import { usePlannerModal } from './usePlannerModal';

afterEach(() => {
  cleanup();
});

export let subscribedPlannerEvent: ((plannerEvent: PlannerStreamEvent) => void) | null = null;

export function plannerEvent(event: Omit<PlannerStreamEvent, 'sessionId'>): PlannerStreamEvent {
  return { sessionId: 'planner-mock-1', ...event };
}

export function createHistorySummary(
  overrides: Partial<PlannerListConversationHistorySummary> = {},
): PlannerListConversationHistorySummary {
  return {
    id: 'conversation-1',
    title: 'Historical planning session',
    createdAt: '2026-03-20T00:00:00.000Z',
    finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
    messageCount: 2,
    taskKind: 'standard',
    scopeMode: 'selected',
    primaryRepoId: 'platform',
    primaryFocusRelativePath: 'src/features/planner',
    ...overrides,
  };
}

export function createHistoryRecord(
  overrides: Partial<PlannerConversationRecord> = {},
): PlannerConversationRecord {
  const taskKind = overrides.sidecarSnapshot?.lineage.taskKind ?? 'standard';
  return {
    id: 'conversation-1',
    contextPackDir: '/tmp/test-context-pack',
    contextPackId: 'test-pack',
    createdAt: '2026-03-20T00:00:00.000Z',
    title: 'Historical planning session',
    finalizedDestinationPath: '/repo/AgentWorkSpace/dropbox/spec.md',
    sidecarSnapshot: {
      version: 1,
      ownership: 'planner-session',
      sessionId: 'historical-session',
      draftFilename: 'spec.md',
      draftPath: '/repo/.staging/spec.md',
      createdAt: '2026-03-20T00:00:00.000Z',
      title: 'Historical planning session',
      primaryRepoId: 'platform',
      primaryRepoRoot: '/repo',
      primaryFocusRelativePath: 'src/features/planner',
      deepFocusEnabled: true,
      primaryFocusTargetKind: 'directory',
      primaryFocusTargets: [],
      selectedTestTarget: null,
      supportTargets: [],
      lineage: {
        taskKind,
        parentTaskId: taskKind === 'child-task' ? 'TASK-001' : '',
        rootTaskId: taskKind === 'child-task' ? 'TASK-ROOT' : '',
        parentQmdRecordId: taskKind === 'child-task' ? 'qmd-1' : '',
        parentQmdScope: taskKind === 'child-task' ? 'qmd/context-packs/test-pack' : '',
        followUpReason: taskKind === 'child-task' ? 'Follow up' : '',
      },
      contextPackBinding: {
        contextPackDir: '/tmp/test-context-pack',
        contextPackId: 'test-pack',
        scopeMode: 'selected',
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        deepFocusEnabled: true,
        selectedFocusPath: 'src/features/planner',
        selectedFocusTargetKind: 'directory',
        selectedFocusTargets: [],
        selectedTestTarget: null,
        selectedSupportTargets: [],
      },
    },
    transcript: [
      { id: 'history-message-1', role: 'operator', text: 'Historical operator question', timestamp: '2026-03-20T00:01:00.000Z' },
      { id: 'history-message-2', role: 'planner', text: 'Historical planner answer', timestamp: '2026-03-20T00:02:00.000Z' },
    ],
    ...overrides,
  };
}

export function createChildTaskHistoryRecord(
  overrides: Partial<PlannerConversationRecord> = {},
): PlannerConversationRecord {
  const base = createHistoryRecord();
  return createHistoryRecord({
    ...overrides,
    sidecarSnapshot: {
      ...base.sidecarSnapshot,
      lineage: {
        ...base.sidecarSnapshot.lineage,
        taskKind: 'child-task',
        parentTaskId: 'TASK-001',
        rootTaskId: 'TASK-ROOT',
        parentQmdRecordId: 'qmd-1',
        parentQmdScope: 'qmd/context-packs/test-pack',
        followUpReason: 'Follow-up',
      },
      ...overrides.sidecarSnapshot,
    },
  });
}

export function createFocusSnapshot(overrides: Partial<PlannerFocusSnapshot> = {}): PlannerFocusSnapshot {
  const record = createHistoryRecord();
  return {
    version: 1,
    contextPackDir: record.contextPackDir,
    contextPackId: record.contextPackId,
    title: record.title,
    primaryRepoId: record.sidecarSnapshot.primaryRepoId,
    primaryRepoRoot: record.sidecarSnapshot.primaryRepoRoot,
    primaryFocusRelativePath: record.sidecarSnapshot.primaryFocusRelativePath,
    primaryFocusTargetKind: record.sidecarSnapshot.primaryFocusTargetKind,
    primaryFocusTargets: record.sidecarSnapshot.primaryFocusTargets,
    selectedTestTarget: record.sidecarSnapshot.selectedTestTarget,
    supportTargets: record.sidecarSnapshot.supportTargets,
    deepFocusEnabled: record.sidecarSnapshot.deepFocusEnabled,
    contextPackBinding: record.sidecarSnapshot.contextPackBinding,
    ...overrides,
  };
}

export function createArchivedTask(overrides: Partial<ArchivedTaskEntry> = {}): ArchivedTaskEntry {
  return {
    taskId: 'TASK-001',
    title: 'Parent task',
    summary: 'Carry forward this work.',
    rootTaskId: 'TASK-ROOT',
    qmdRecordId: 'qmd-1',
    followupReason: 'Follow-up',
    year: '2026',
    archivePath: '/repo/archive/task.md',
    contextPackName: 'test-pack',
    plannerFocusSnapshot: createFocusSnapshot(),
    ...overrides,
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

beforeEach(() => {
  subscribedPlannerEvent = null;
  window.desktopShell = {
    ...window.desktopShell,
    onPlannerEvent: vi.fn((callback) => {
      subscribedPlannerEvent = callback;
      return vi.fn();
    }),
  } as typeof window.desktopShell;
  vi.mocked(window.desktopShell.log.emit).mockClear();
});

export function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    submitPlannerDraft: vi.fn().mockResolvedValue({
      ok: true,
      response: createPlannerSubmitResponse({
        message: 'Draft accepted.',
        draftTitle: 'Test',
      }),
    }),
    ...overrides,
  });
}

export function makeWrapper(client: DesktopShellClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <ObservabilityProvider client={client}>{children}</ObservabilityProvider>
      </ToastProvider>
    );
  };
}

export function renderPlannerModalHook(
  client?: DesktopShellClient,
  options?: {
    hasActiveContextPack?: boolean;
    activeContextPackDir?: string | null;
    deepFocusSelection?: PlannerStartSessionDeepFocusSelection;
  },
) {
  const c = client ?? createClient();
  const hasActive = options?.hasActiveContextPack ?? true;
  const activeDir = options && 'activeContextPackDir' in options
    ? options.activeContextPackDir ?? null
    : hasActive ? '/tmp/test-context-pack' : null;
  return renderHook(
    () => {
      const [contractError, setContractError] = useState('');
      return usePlannerModal(
        c,
        'idle',
        hasActive,
        contractError,
        setContractError,
        activeDir,
        options?.deepFocusSelection,
      );
    },
    { wrapper: makeWrapper(c) },
  );
}
