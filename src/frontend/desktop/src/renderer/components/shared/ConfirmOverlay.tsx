import type { ReactNode } from 'react';

import '../../styles/confirmOverlay.css';

export type ConfirmOverlayProps = {
  visible: boolean;
  icon: ReactNode;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  confirmVariant?: 'primary' | 'danger';
  autoFocusCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  ariaLabel?: string;
};

export default function ConfirmOverlay({
  visible,
  icon,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'primary',
  autoFocusCancel = false,
  onConfirm,
  onCancel,
  ariaLabel,
}: ConfirmOverlayProps): JSX.Element | null {
  if (!visible) return null;

  const confirmClass = confirmVariant === 'danger'
    ? 'mcp-modal__btn mcp-modal__btn--danger'
    : 'mcp-modal__btn mcp-modal__btn--primary';

  return (
    <div className="confirm-overlay" role="alertdialog" aria-label={ariaLabel ?? title}>
      <div className="confirm-overlay__card">
        <div className="confirm-overlay__icon" aria-hidden="true">
          {icon}
        </div>
        <h3 className="confirm-overlay__title">{title}</h3>
        <div className="confirm-overlay__body">{body}</div>
        <div className="confirm-overlay__actions">
          <button
            type="button"
            className="mcp-modal__btn"
            onClick={onCancel}
            autoFocus={autoFocusCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={confirmClass}
            onClick={onConfirm}
            autoFocus={!autoFocusCancel}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
