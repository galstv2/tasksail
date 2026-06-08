import type { Toast } from '../../hooks/shared/useToast';
import { classNames } from '../../utils/classNames';

type ToastContainerProps = {
  toasts: Toast[];
  onDismiss: (id: string) => void;
};

function ToastContainer({ toasts, onDismiss }: ToastContainerProps): JSX.Element | null {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={classNames('toast', `toast--${toast.severity}`)} role="status">
          <span className="toast__message">{toast.message}</span>
          <button
            className="toast__dismiss"
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
