import {
  refreshRuntimeStreamState,
  resetRuntimeStreamState,
} from './main.runtimeStream';
import {
  refreshStreamTaskMetadataForScope,
  resetStreamState,
} from './main.stream';
import { getCurrentActiveContextPackTaskScope } from './main.contextPackTaskVisibility';
import { createLogger } from './log/logger';

const log = createLogger('electron/main');

export async function refreshTerminalScopeCaches(): Promise<void> {
  resetStreamState();
  try {
    await refreshStreamTaskMetadataForScope(getCurrentActiveContextPackTaskScope());
  } catch (error: unknown) {
    log.warn('terminal.scope-cache-refresh.failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  resetRuntimeStreamState();
  await refreshRuntimeStreamState();
}
