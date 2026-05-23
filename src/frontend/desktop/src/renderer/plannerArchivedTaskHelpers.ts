import type {
  ArchivedTaskEntry,
  PlannerChildTaskLineage,
} from '../shared/desktopContract';
import type {
  PlannerConversationRecord,
  PlannerStagingSidecar,
} from '../../../../backend/platform/planner-history/types.js';
import { deriveParentQmdScope } from './plannerComposer';

export function archivedTaskFromRecord(record: PlannerConversationRecord): ArchivedTaskEntry {
  const lineage = record.sidecarSnapshot.lineage;
  const fallbackParentTaskId = lineage.parentTaskId || record.id;
  return {
    taskId: fallbackParentTaskId,
    title: lineage.parentTaskId || record.title,
    summary: record.title,
    rootTaskId: lineage.rootTaskId || fallbackParentTaskId,
    qmdRecordId: lineage.parentQmdRecordId,
    followupReason: lineage.followUpReason,
    year: new Date(record.createdAt).getUTCFullYear().toString(),
    archivePath: record.finalizedDestinationPath,
    archivedAt: record.createdAt,
    contextPackName: getContextPackName(record.sidecarSnapshot),
  };
}

export function buildChildTaskLineage(task: ArchivedTaskEntry): PlannerChildTaskLineage {
  return {
    parentTaskId: task.taskId,
    parentQmdRecordId: task.qmdRecordId,
    parentQmdScope: deriveParentQmdScope(task.contextPackName),
    rootTaskId: task.rootTaskId || task.taskId,
    followUpReason: task.followupReason || 'Continue from the archived parent task.',
  };
}

function getContextPackName(sidecar: PlannerStagingSidecar): string {
  const explicitId = sidecar.contextPackBinding.contextPackId.trim();
  if (explicitId) {
    return explicitId;
  }
  const parts = sidecar.contextPackBinding.contextPackDir.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
