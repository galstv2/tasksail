import type {
  ArchivedTaskEntry,
  PlannerChildTaskLineage,
} from '../shared/desktopContract';
import { deriveParentQmdScope } from './plannerComposer';

export function buildChildTaskLineage(task: ArchivedTaskEntry): PlannerChildTaskLineage {
  return {
    parentTaskId: task.taskId,
    parentQmdRecordId: task.qmdRecordId,
    parentQmdScope: deriveParentQmdScope(task.contextPackName),
    rootTaskId: task.rootTaskId || task.taskId,
    followUpReason: task.followupReason || 'Continue from the archived parent task.',
  };
}
