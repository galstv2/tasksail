import { useToastContext } from '../../contexts/ToastContext';
import { createLogger } from '../../log/logger';

const log = createLogger('src/renderer/hooks/useErrorToast');

export function useErrorToast(): {
  reportError: (error: unknown, toastMessage?: string) => void;
} {
  const { addToast } = useToastContext();

  return {
    reportError: (error, toastMessage) => {
      log.error('app.error.reported', error);
      addToast({
        message: toastMessage ?? humanMessage(error),
        severity: 'error',
      });
    },
  };
}

function humanMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
