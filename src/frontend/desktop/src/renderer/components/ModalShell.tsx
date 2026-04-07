import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { classNames } from '../utils/classNames';
import { registerEscHandler } from '../utils/modalShellEscRegistry';
import { CloseIcon } from './creation-steps/icons';

import '../styles/modalShell.css';

export type ModalShellProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  maxWidth?: string;
  maxHeight?: string;
  variant?: 'default' | 'terminal';
  accentColor?: string;
  headerLeft?: ReactNode;
  footer?: ReactNode;
  className?: string;
  zIndex?: number;
  escPriority?: number;
  interactive?: boolean;
  ariaLabel?: string;
  children: ReactNode;
};

const EXIT_DURATION_MS = 150;

export default function ModalShell({
  isOpen,
  onClose,
  title,
  subtitle,
  maxWidth = '600px',
  maxHeight = '82vh',
  variant = 'default',
  accentColor,
  headerLeft,
  footer,
  className,
  zIndex,
  escPriority = 0,
  interactive = true,
  ariaLabel,
  children,
}: ModalShellProps): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setVisible(true);
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
        closingTimerRef.current = null;
      }
    } else if (visible && !closing) {
      setClosing(true);
      closingTimerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        closingTimerRef.current = null;
      }, EXIT_DURATION_MS);
    }
  }, [isOpen, visible, closing]);

  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible || closing) return;
    return registerEscHandler(escPriority, onClose);
  }, [visible, closing, escPriority, onClose]);

  if (!visible) return null;

  const overlayClasses = classNames(
    'modal-shell__overlay',
    closing && 'modal-shell__overlay--closing',
    !interactive && 'modal-shell__overlay--non-interactive',
  );

  const containerClasses = classNames(
    'modal-shell',
    variant === 'terminal' && 'modal-shell--terminal',
    !interactive && 'modal-shell--non-interactive',
    className,
  );

  const overlayStyle: CSSProperties = zIndex ? { zIndex } : {};
  const containerStyle: CSSProperties = {
    '--modal-shell-max-w': maxWidth,
    '--modal-shell-max-h': maxHeight,
    ...(accentColor ? { '--modal-shell-accent': accentColor } : {}),
  } as CSSProperties;

  const handleOverlayClick = interactive
    ? (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }
    : undefined;

  return (
    <div
      className={overlayClasses}
      style={overlayStyle}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className={containerClasses}
        style={containerStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-shell__header">
          {headerLeft}
          <div className="modal-shell__header-content">
            <h2 className="modal-shell__title">{title}</h2>
            {subtitle && <p className="modal-shell__subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-shell__close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="modal-shell__body">
          {children}
        </div>

        {footer && (
          <footer className="modal-shell__footer">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
