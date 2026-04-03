import type {
  ContextPackApplyResponse,
  ContextPackClearResponse,
  ContextPackCreateResponse,
  ContextPackDiscoverPrefillResponse,
  ContextPackListResponse,
  ContextPackPickDirectoryResponse,
  ContextPackPreviewResponse,
  ContextPackReseedResponse,
  TaskBoardReadBoardResponse,
} from './desktopContract';

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
