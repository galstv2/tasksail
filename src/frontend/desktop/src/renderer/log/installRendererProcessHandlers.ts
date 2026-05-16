import { RendererError } from '../../shared/errors';
import { createLogger } from './logger';

let activeCleanup: (() => void) | undefined;

export function installRendererProcessHandlers(): () => void {
  if (activeCleanup) {
    return activeCleanup;
  }

  const log = createLogger('src/renderer/log/installRendererProcessHandlers');
  const errorHandler = (event: ErrorEvent): void => {
    log.error(
      'renderer.uncaught.exception',
      event.error ?? new RendererError(event.message, { code: 'UNCAUGHT', category: 'system' }),
      { filename: event.filename, lineno: event.lineno },
    );
  };
  const rejectionHandler = (event: PromiseRejectionEvent): void => {
    log.error('renderer.unhandled.rejection', event.reason, {});
  };

  window.addEventListener('error', errorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);
  activeCleanup = () => {
    window.removeEventListener('error', errorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
    activeCleanup = undefined;
  };
  return activeCleanup;
}
