export {
  HANDOFF_FILES,
  LINEAGE_LABELS,
  resolveQueuePaths,
  templateSourceFor,
} from './paths.js';

export type { QueuePaths } from './paths.js';

export {
  extractTaskTitle,
  templateMetadataLine,
  printTaskMetadataBlock,
  printTaskLineageBlock,
  extractLineageValue,
  extractTaskMetadataValue,
  formatContextPackBindingSection,
} from './markdown.js';

export {
  injectLabelValues,
  injectSectionContent,
  stampHandoffTemplate,
  stampParallelAssignmentsTemplate,
} from './artifacts.js';

export {
  hasSubstantiveContent,
  initializeTaskArtifacts,
  resetHandoffArtifacts,
  clearRuntimeReceipts,
  handoffFileIsResetState,
  handoffWorkspaceIsReady,
  finalSummaryHasContent,
} from './lifecycle.js';

export type { InitializeTaskOptions as InitializeTaskArtifactOptions } from './lifecycle.js';

export {
  acquireDirLock,
  acquireDirLockOrThrow,
  getActiveTaskIds,
  hasAnyActiveTask,
  nextPendingItemPath,
  queueNameForSource,
  moveDropboxItemsOnce,
  moveDropboxItemToPending,
  activateNextPendingItemIfReady,
  completeActiveItem,
} from './operations.js';

export type {
  CompleteActiveItemOptions,
  ActivateNextPendingItemOptions,
  ActivateNextPendingItemResult,
} from './operations.js';

export { createDropboxTask } from './createDropboxTask.js';
export type { CreateDropboxTaskOptions } from './createDropboxTask.js';

export { createFollowupTask } from './createFollowupTask.js';
export type { CreateFollowupTaskOptions } from './createFollowupTask.js';

export { initializeTask } from './newTask.js';
export type { InitializeTaskOptions } from './newTask.js';

export { getQueueStatus } from './queueStatus.js';
export type { QueueStatusResult } from './queueStatus.js';

export { completePendingItem } from './completePendingItem.js';
export type { CompletePendingItemOptions } from './completePendingItem.js';
export {
  getRetrospectiveRequiredForNextTask,
  isRetrospectiveRequiredForCompletedCount,
  syncRetrospectiveRequiredMetadata,
} from './retrospectiveFlag.js';

export { pollDropbox } from './pollDropbox.js';
export type { PollDropboxOptions } from './pollDropbox.js';

export { repairQueue } from './repairQueue.js';
export type { RepairResult, RepairQueueOptions } from './repairQueue.js';
export { recoverStuckMidCompletion } from './recoverStuckMidCompletion.js';
export type { RecoverStuckMidCompletionResult } from './recoverStuckMidCompletion.js';

export { runPolicyValidation, assertPolicyPasses } from './policyValidation.js';
export type { PolicyValidationMode, PolicyValidationResult } from './policyValidation.js';

export { fileTaskArchive } from './archive.js';
export type { FileTaskArchiveOptions, FileTaskArchiveResult } from './archive.js';

export { deletePendingItem } from './deletePendingItem.js';
export type { DeletePendingItemOptions } from './deletePendingItem.js';

export { deleteDropboxItem } from './deleteDropboxItem.js';
export type { DeleteDropboxItemOptions } from './deleteDropboxItem.js';

export { deleteErrorItem } from './deleteErrorItem.js';
export type { DeleteErrorItemOptions } from './deleteErrorItem.js';

export { moveFailedItemToErrorItems, commitTaskSnapshot, requeueErrorItem, moveErrorItemToDropbox } from './errorItems.js';
export type { MoveFailedItemResult } from './errorItems.js';

export { readQueueOrderManifest, writeQueueOrderManifest, insertIntoQueueManifest } from './operations.js';

export { main as cli } from './cli.js';
