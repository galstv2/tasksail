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
  TaskBoardKillTaskResponse,
  TaskBoardRetryKillCleanupResponse,
  TaskNotificationEvent,
  TaskNotificationMutationResponse,
  TaskNotificationRecord,
  TaskNotificationSnapshot,
  AgentConfigLoadCapabilitiesResponse,
} from './desktopContract';
import { isFiniteNumber, isNonEmptyString } from './desktopContractValidationCore';
import { isRecord } from './desktopContractValidators';

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

export function isTaskBoardReadBoardResponse(
  response: unknown,
): response is TaskBoardReadBoardResponse {
  if (!isRecord(response)) return false;
  if (response.action !== 'taskBoard.readBoard') return false;
  if (!Array.isArray(response.dropboxItems)) return false;
  if (!Array.isArray(response.pendingItems)) return false;
  if (!Array.isArray(response.errorItems)) return false;
  if (!Array.isArray(response.completedItems)) return false;
  return response.pendingItems.every(isTaskBoardPendingItem);
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
