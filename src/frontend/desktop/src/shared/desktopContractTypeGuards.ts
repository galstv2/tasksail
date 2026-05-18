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
} from './desktopContract';
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

export function isTaskBoardReadBoardResponse(
  response: unknown,
): response is TaskBoardReadBoardResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'action' in response &&
    response.action === 'taskBoard.readBoard'
  );
}
