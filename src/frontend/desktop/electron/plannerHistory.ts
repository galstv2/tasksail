import { basename } from 'node:path';

import {
  getPlannerHistoryRecord,
  listPlannerHistoryForPack,
  upsertPlannerHistoryRecord,
} from '../../../backend/platform/planner-history/store.js';
import { writeStagedPlannerFocusSnapshot } from '../../../backend/platform/queue/plannerFocusSnapshotStaging.js';
import type {
  PlannerConversationRecord,
  PlannerConversationTranscriptMessage,
  PlannerStagingSidecar,
} from '../../../backend/platform/planner-history/types.js';
import { TRANSCRIPT_MESSAGE_CAP } from '../../../backend/platform/planner-history/types.js';
import type {
  DesktopInvokeResult,
  PlannerFocusSnapshot,
  PlannerHydrateConversationResponse,
  PlannerListConversationHistoryResponse,
  PlannerListConversationHistorySummary,
} from '../src/shared/desktopContract';
import { readWorkspaceSyncStateSnapshot } from './main.contextPackCatalog';
import { REPO_ROOT } from './paths';

type PlannerPendingRecord = {
  id: string;
  contextPackDir: string;
  contextPackId: string;
  startedAt: string;
  title: string;
  sidecarSnapshot: PlannerStagingSidecar;
  transcript: PlannerConversationTranscriptMessage[];
};

let pending: PlannerPendingRecord | null = null;
let messageSequence = 0;

function cloneSidecar(sidecar: PlannerStagingSidecar): PlannerStagingSidecar {
  return JSON.parse(JSON.stringify(sidecar)) as PlannerStagingSidecar;
}

export function projectPlannerFocusSnapshot(record: PlannerConversationRecord): PlannerFocusSnapshot {
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
  };
}

function nextMessageId(role: PlannerConversationTranscriptMessage['role']): string {
  messageSequence += 1;
  return `${role}-${Date.now()}-${messageSequence}`;
}

export function beginPendingRecord(
  sessionId: string,
  contextPackDir: string,
  sidecarSnapshot: PlannerStagingSidecar,
): void {
  const snapshot = cloneSidecar(sidecarSnapshot);
  pending = {
    id: sessionId,
    contextPackDir,
    contextPackId: snapshot.contextPackBinding.contextPackId || basename(contextPackDir),
    startedAt: new Date().toISOString(),
    title: snapshot.title,
    sidecarSnapshot: snapshot,
    transcript: [],
  };
}

export function appendPendingMessage(
  role: PlannerConversationTranscriptMessage['role'],
  text: string,
  timestamp: string = new Date().toISOString(),
  sessionId?: string,
): void {
  if (!pending || (sessionId !== undefined && pending.id !== sessionId)) {
    return;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  pending.transcript.push({
    id: nextMessageId(role),
    role,
    text: trimmed,
    timestamp,
  });
  if (pending.transcript.length > TRANSCRIPT_MESSAGE_CAP) {
    pending.transcript.splice(0, pending.transcript.length - TRANSCRIPT_MESSAGE_CAP);
  }
}

export function discardPendingRecord(): void {
  pending = null;
}

export async function commitPendingRecordToHistory(
  finalizedDestinationPath: string,
): Promise<PlannerConversationRecord | null> {
  if (!pending) {
    return null;
  }
  const record: PlannerConversationRecord = {
    id: pending.id,
    contextPackDir: pending.contextPackDir,
    contextPackId: pending.contextPackId,
    createdAt: new Date().toISOString(),
    title: pending.title,
    finalizedDestinationPath,
    sidecarSnapshot: cloneSidecar(pending.sidecarSnapshot),
    transcript: pending.transcript.map((message) => ({ ...message })),
  };
  await upsertPlannerHistoryRecord({ repoRoot: REPO_ROOT, record });
  const taskId = basename(record.finalizedDestinationPath, '.md');
  try {
    await writeStagedPlannerFocusSnapshot({
      repoRoot: REPO_ROOT,
      taskId,
      markdownDestination: record.finalizedDestinationPath,
      snapshot: projectPlannerFocusSnapshot(record),
    });
  } catch {
    console.warn(`planner-focus-snapshot: skipped for finalizedDestinationPath=${record.finalizedDestinationPath} reason=write-failed`);
  }
  discardPendingRecord();
  return record;
}

function getActiveContextPackMessage(): PlannerListConversationHistoryResponse {
  return {
    action: 'planner.listConversationHistory',
    mode: 'no-context-pack',
    message: 'No active context pack.',
    conversations: [],
  };
}

function toSummary(record: PlannerConversationRecord): PlannerListConversationHistorySummary {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    finalizedDestinationPath: record.finalizedDestinationPath,
    messageCount: record.transcript.length,
    taskKind: record.sidecarSnapshot.lineage.taskKind,
    scopeMode: record.sidecarSnapshot.contextPackBinding.scopeMode,
    primaryRepoId: record.sidecarSnapshot.primaryRepoId,
    primaryFocusRelativePath: record.sidecarSnapshot.primaryFocusRelativePath,
  };
}

export async function listConversationHistoryAction(): Promise<DesktopInvokeResult> {
  try {
    const syncState = await readWorkspaceSyncStateSnapshot();
    if (!syncState.activeContextPackDir) {
      return { ok: true, response: getActiveContextPackMessage() };
    }
    const records = await listPlannerHistoryForPack({
      repoRoot: REPO_ROOT,
      contextPackDir: syncState.activeContextPackDir,
      contextPackId: syncState.activeContextPackId ?? undefined,
    });
    const response: PlannerListConversationHistoryResponse = {
      action: 'planner.listConversationHistory',
      mode: records.length > 0 ? 'found' : 'empty',
      message: records.length > 0
        ? `Found ${records.length} finalized planner conversation(s).`
        : 'No finalized planner conversations for the active context pack.',
      conversations: records.map(toSummary),
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.listConversationHistory',
      error: error instanceof Error ? error.message : 'Failed to list planner conversation history.',
    };
  }
}

export async function hydrateConversationAction(
  recordId: string,
): Promise<DesktopInvokeResult> {
  try {
    const syncState = await readWorkspaceSyncStateSnapshot();
    if (!syncState.activeContextPackDir) {
      const response: PlannerHydrateConversationResponse = {
        action: 'planner.hydrateConversation',
        mode: 'not-found',
        message: 'No active context pack.',
        record: null,
      };
      return { ok: true, response };
    }
    const record = await getPlannerHistoryRecord({
      repoRoot: REPO_ROOT,
      contextPackDir: syncState.activeContextPackDir,
      contextPackId: syncState.activeContextPackId ?? undefined,
      recordId,
    });
    const response: PlannerHydrateConversationResponse = {
      action: 'planner.hydrateConversation',
      mode: record ? 'found' : 'not-found',
      message: record ? 'Planner conversation hydrated.' : 'Planner conversation was not found for the active context pack.',
      record,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    return {
      ok: false,
      action: 'planner.hydrateConversation',
      error: error instanceof Error ? error.message : 'Failed to hydrate planner conversation.',
    };
  }
}
