import type {
  ContextPackApplyResponse,
  ContextPackClearResponse,
  ContextPackCreateResponse,
  ContextPackDiscoverPrefillResponse,
  ContextPackCatalogChangedEvent,
  ContextPackListResponse,
  ContextPackPickDirectoryResponse,
  ContextPackPreviewResponse,
  ContextPackReseedResponse,
  DeepFocusLoadSelectionsResponse,
  FocusFiltersCreateResponse,
  FocusFiltersDeleteResponse,
  FocusFiltersListResponse,
  ContextPackSidebarStateLoadResponse,
  PackSeedState,
  TaskBoardReadBoardResponse,
  TaskBoardReadChildChainBranchInventoryResponse,
  TaskBoardChildChainBranchInventory,
  TaskBoardChildChainBranchInventoryRow,
  TaskBoardKillTaskResponse,
  TaskBoardRetryKillCleanupResponse,
  TaskNotificationEvent,
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
  AgentConfigLoadCapabilitiesResponse,
} from './desktopContract';
import { isFiniteNumber, isNonEmptyString, isRecord } from './desktopContractValidationCore';

export function isContextPackCatalogChangedEvent(
  event: unknown,
): event is ContextPackCatalogChangedEvent {
  if (!isRecord(event)) return false;
  return (
    typeof event.changedRoot === 'string' &&
    (
      event.reason === 'mkdir' ||
      event.reason === 'rmdir' ||
      event.reason === 'rename' ||
      event.reason === 'unknown'
    )
  );
}

export function isAgentConfigLoadCapabilitiesResponse(
  response: unknown,
): response is AgentConfigLoadCapabilitiesResponse {
  if (!isRecord(response)) return false;
  if (response.action !== 'agentConfig.loadCapabilities') return false;
  if (response.mode !== 'read-only') return false;
  if (!isNonEmptyString(response.message)) return false;
  if (!isNonEmptyString(response.providerId)) return false;
  if (response.cliVersion !== null && typeof response.cliVersion !== 'string') return false;
  if (!Array.isArray(response.effortChoices)) return false;
  if (!response.effortChoices.every((choice) => typeof choice === 'string')) return false;
  return typeof response.stale === 'boolean';
}

export function isContextPackListResponse(
  response: unknown,
): response is ContextPackListResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPack.list'
  );
}

export function isContextPackSwitchResponse(
  response: unknown,
): response is
  | ContextPackPreviewResponse
  | ContextPackApplyResponse
  | ContextPackClearResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    (response.action === 'contextPack.previewSwitch' ||
      response.action === 'contextPack.applySwitch' ||
      response.action === 'contextPack.clearActive')
  );
}

export function isContextPackReseedResponse(
  response: unknown,
): response is ContextPackReseedResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPack.reseed'
  );
}

export function isPickDirectoryResponse(
  response: unknown,
): response is ContextPackPickDirectoryResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPack.pickDirectory'
  );
}

export function isDiscoverPrefillResponse(
  response: unknown,
): response is ContextPackDiscoverPrefillResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPack.discoverPrefill'
  );
}

export function isCreateResponse(
  response: unknown,
): response is ContextPackCreateResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPack.create'
  );
}

export function isDeepFocusLoadSelectionsResponse(
  response: unknown,
): response is DeepFocusLoadSelectionsResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'deepFocus.loadSelections'
  );
}

export function isFocusFiltersListResponse(
  response: unknown,
): response is FocusFiltersListResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'focusFilters.list'
  );
}

export function isFocusFiltersCreateResponse(
  response: unknown,
): response is FocusFiltersCreateResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'focusFilters.create'
  );
}

export function isFocusFiltersDeleteResponse(
  response: unknown,
): response is FocusFiltersDeleteResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'focusFilters.delete'
  );
}

export function isContextPackSidebarStateLoadResponse(
  response: unknown,
): response is ContextPackSidebarStateLoadResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'contextPackSidebarState.load'
  );
}

/**
 * Narrow an unknown value to the {@link PackSeedState} string union.
 * Renderer code that constructs catalog entries (e.g. session-created entries
 * in ``useContextPackSelection``) and tests that build mock catalog responses
 * use this to avoid stringly-typed assignments.
 */
export function isPackSeedState(value: unknown): value is PackSeedState {
  return value === 'seeded' || value === 'bootstrap-empty';
}

const TASK_BOARD_PENDING_STATES = ['active', 'activating', 'pending', 'stopping'] as const;
const TASK_BOARD_STOP_CLEANUP_CODES = [
  'unproven-stopped',
  'failed-item-cleanup-failed',
  'activation-cleanup-failed',
  'unexpected-cleanup-error',
] as const;

function isTaskBoardPendingItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.fileName !== 'string') return false;
  if (value.taskId !== null && typeof value.taskId !== 'string') return false;
  if (value.title !== null && typeof value.title !== 'string') return false;
  if (!TASK_BOARD_PENDING_STATES.includes(value.state as typeof TASK_BOARD_PENDING_STATES[number])) return false;
  if (value.stopCleanupStatus !== undefined && value.stopCleanupStatus !== 'failed') return false;
  if (
    value.stopCleanupErrorCode !== undefined
    && !TASK_BOARD_STOP_CLEANUP_CODES.includes(value.stopCleanupErrorCode as typeof TASK_BOARD_STOP_CLEANUP_CODES[number])
  ) {
    return false;
  }
  if (value.stopCleanupFailedAt !== undefined && typeof value.stopCleanupFailedAt !== 'string') return false;
  if (value.stopCleanupMessage !== undefined && typeof value.stopCleanupMessage !== 'string') return false;
  if (value.stopCleanupRetryable !== undefined && typeof value.stopCleanupRetryable !== 'boolean') return false;
  return true;
}

function isTaskBoardItem(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.fileName !== 'string' || !value.fileName) return false;
  if (value.taskId !== null && typeof value.taskId !== 'string') return false;
  if (value.title !== null && typeof value.title !== 'string') return false;
  return true;
}

function assertUniqueTaskBoardIdentities(
  dropboxItems: unknown[],
  pendingItems: unknown[],
  errorItems: unknown[],
  completedItems: unknown[],
): boolean {
  const seenFileName = new Set<string>();
  const seenTaskId = new Set<string>();

  const checkItem = (item: unknown): boolean => {
    if (!isRecord(item)) return true;
    if (typeof item.fileName === 'string' && item.fileName) {
      if (seenFileName.has(item.fileName)) return false;
      seenFileName.add(item.fileName);
    }
    if (typeof item.taskId === 'string' && item.taskId) {
      if (seenTaskId.has(item.taskId)) return false;
      seenTaskId.add(item.taskId);
    }
    return true;
  };

  for (const items of [dropboxItems, pendingItems, errorItems]) {
    for (const item of items) {
      if (!checkItem(item)) return false;
    }
  }
  // completedItems key by taskId only
  for (const item of completedItems) {
    if (!isRecord(item)) continue;
    if (typeof item.taskId === 'string' && item.taskId) {
      if (seenTaskId.has(item.taskId)) return false;
      seenTaskId.add(item.taskId);
    }
  }
  return true;
}

// Shape guard for completed board rows (ArchivedTaskEntry). Validates the required
// fields the renderer relies on; optional child-chain / branch-handoff metadata is
// left to the callers that consume it, per the contract's "do not over-tighten".
function isArchivedTaskEntry(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.taskId !== 'string' || !value.taskId) return false;
  if (value.title !== null && typeof value.title !== 'string') return false;
  if (typeof value.summary !== 'string') return false;
  if (typeof value.rootTaskId !== 'string') return false;
  if (typeof value.qmdRecordId !== 'string') return false;
  if (typeof value.followupReason !== 'string') return false;
  if (typeof value.year !== 'string') return false;
  if (typeof value.archivePath !== 'string') return false;
  if (value.archivedAt !== null && typeof value.archivedAt !== 'string') return false;
  if (typeof value.contextPackName !== 'string') return false;
  return true;
}

export function isTaskBoardReadBoardResponse(
  response: unknown,
): response is TaskBoardReadBoardResponse {
  if (!isRecord(response)) return false;
  if (response.action !== 'taskBoard.readBoard') return false;
  if (typeof response.boardSnapshotSequence !== 'number' || !Number.isFinite(response.boardSnapshotSequence)) return false;
  if (!Array.isArray(response.dropboxItems)) return false;
  if (!Array.isArray(response.pendingItems)) return false;
  if (!Array.isArray(response.errorItems)) return false;
  if (!Array.isArray(response.completedItems)) return false;
  if (!response.dropboxItems.every(isTaskBoardItem)) return false;
  if (!response.errorItems.every(isTaskBoardItem)) return false;
  if (!response.pendingItems.every(isTaskBoardPendingItem)) return false;
  if (!response.completedItems.every(isArchivedTaskEntry)) return false;
  if (!assertUniqueTaskBoardIdentities(
    response.dropboxItems as unknown[],
    response.pendingItems as unknown[],
    response.errorItems as unknown[],
    response.completedItems as unknown[],
  )) return false;
  return true;
}

export function isTaskBoardKillTaskResponse(
  response: unknown,
): response is TaskBoardKillTaskResponse {
  if (!isRecord(response)) return false;
  if (response.action !== 'taskBoard.killTask') return false;
  if (response.mode !== 'failed' && response.mode !== 'kill-requested') return false;
  if (typeof response.message !== 'string' || typeof response.taskId !== 'string') return false;
  if (response.movedItem !== undefined && typeof response.movedItem !== 'string') return false;
  if (response.nextActiveItem !== undefined && response.nextActiveItem !== null && typeof response.nextActiveItem !== 'string') return false;
  return true;
}

export function isTaskBoardRetryKillCleanupResponse(
  response: unknown,
): response is TaskBoardRetryKillCleanupResponse {
  if (!isRecord(response)) return false;
  return response.action === 'taskBoard.retryKillCleanup'
    && response.mode === 'cleanup-retry-scheduled'
    && typeof response.message === 'string'
    && typeof response.taskId === 'string';
}

function isTaskBoardChildChainBranchInventoryRow(
  value: unknown,
): value is TaskBoardChildChainBranchInventoryRow {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.repoRoot)) return false;
  // repoLabel may be empty per the contract type and the aggregation merge logic.
  if (typeof value.repoLabel !== 'string') return false;
  if (!isNonEmptyString(value.chainSourceBranch)) return false;
  if (!isNonEmptyString(value.introducedAtTaskId)) return false;
  const kind = value.sourceKind;
  if (
    kind !== 'parent-handoff'
    && kind !== 'chain-history-handoff'
    && kind !== 'introduced-by-child'
    && kind !== 'legacy-root'
  ) {
    return false;
  }
  if (!isFiniteNumber(value.introducedAtDepth)) return false;
  if (!(value.targetBranch === null || typeof value.targetBranch === 'string')) return false;
  return true;
}

function isTaskBoardChildChainBranchInventory(
  value: unknown,
): value is TaskBoardChildChainBranchInventory {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (!isNonEmptyString(value.rootTaskId)) return false;
  if (!isNonEmptyString(value.selectedTaskId)) return false;
  if (!isNonEmptyString(value.currentTipTaskId)) return false;
  if (!isFiniteNumber(value.taskCount)) return false;
  if (typeof value.generatedAt !== 'string') return false;
  if (!Array.isArray(value.rows)) return false;
  return value.rows.every(isTaskBoardChildChainBranchInventoryRow);
}

export function isTaskBoardReadChildChainBranchInventoryResponse(
  response: unknown,
): response is TaskBoardReadChildChainBranchInventoryResponse {
  if (!isRecord(response)) return false;
  if (response.action !== 'taskBoard.readChildChainBranchInventory') return false;
  if (
    response.mode !== 'loaded'
    && response.mode !== 'not-chain-task'
    && response.mode !== 'invalid-state'
  ) {
    return false;
  }
  if (typeof response.message !== 'string') return false;
  if (response.mode === 'loaded') {
    return isTaskBoardChildChainBranchInventory(response.inventory);
  }
  return response.inventory === undefined;
}

const TASK_NOTIFICATION_TYPES = ['task-completed', 'task-failed'] as const;
const TASK_NOTIFICATION_SEVERITIES = ['success', 'error'] as const;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isTaskNotificationRecord(
  record: unknown,
): record is TaskNotificationRecord {
  if (!isRecord(record)) return false;
  if (!isNonEmptyString(record.notificationId)) return false;
  if (!isNonEmptyString(record.dedupeKey)) return false;
  if (!TASK_NOTIFICATION_TYPES.includes(record.type as typeof TASK_NOTIFICATION_TYPES[number])) return false;
  if (!TASK_NOTIFICATION_SEVERITIES.includes(record.severity as typeof TASK_NOTIFICATION_SEVERITIES[number])) return false;
  if (!isNonEmptyString(record.taskId)) return false;
  if (!isNullableString(record.taskGuid)) return false;
  if (!isNullableString(record.taskTitle)) return false;
  if (!isNullableString(record.taskFileName)) return false;
  if (!isNullableString(record.contextPackId)) return false;
  if (!isNullableString(record.contextPackDir)) return false;
  if (!isNullableString(record.contextPackLabel)) return false;
  if (!isNullableString(record.archivePath)) return false;
  if (!isNullableString(record.errorItemPath)) return false;
  if (!isNonEmptyString(record.createdAt)) return false;
  if (!isNullableString(record.seenAt)) return false;
  if (!isNullableString(record.dismissedAt)) return false;
  return isNonEmptyString(record.message);
}

export function isTaskNotificationSnapshot(
  snapshot: unknown,
): snapshot is TaskNotificationSnapshot {
  if (!isRecord(snapshot)) return false;
  if (snapshot.action !== 'taskNotifications.read') return false;
  if (snapshot.mode !== 'read-only') return false;
  if (!isFiniteNumber(snapshot.unseenCount)) return false;
  if (!Array.isArray(snapshot.notifications)) return false;
  if (!snapshot.notifications.every(isTaskNotificationRecord)) return false;
  if (!isNonEmptyString(snapshot.generatedAt)) return false;
  return isNonEmptyString(snapshot.message);
}

export function isTaskNotificationMutationResponse(
  response: unknown,
): response is TaskNotificationMutationResponse {
  if (!isRecord(response)) return false;
  if (
    response.action !== 'taskNotifications.markSeen'
    && response.action !== 'taskNotifications.dismiss'
    && response.action !== 'taskNotifications.dismissAll'
  ) return false;
  if (response.mode !== 'updated') return false;
  if (!isFiniteNumber(response.unseenCount)) return false;
  if (!Array.isArray(response.notifications)) return false;
  if (!response.notifications.every(isTaskNotificationRecord)) return false;
  if (!isNonEmptyString(response.generatedAt)) return false;
  return isNonEmptyString(response.message);
}

export function isTaskNotificationEvent(
  event: unknown,
): event is TaskNotificationEvent {
  return isRecord(event)
    && event.type === 'snapshot'
    && isTaskNotificationSnapshot(event.snapshot);
}
