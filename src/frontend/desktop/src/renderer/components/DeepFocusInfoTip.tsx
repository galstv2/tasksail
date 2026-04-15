import { useCallback, useRef, useState } from 'react';

const TOOLTIP_TEXT =
  'Regular mode sends your full workspace as context. Deep Focus narrows context to only the paths you select. These are completely separate modes.';

type Position = { top: number; right: number };

export function DeepFocusInfoTip(): JSX.Element {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const show = useCallback(() => {
    const el = iconRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right + 2,
    });
  }, []);

  const hide = useCallback(() => {
    setPos(null);
  }, []);

  return (
    <span
      ref={iconRef}
      className="deep-focus-info-tip"
      aria-label="About Deep Focus Mode"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
        <path d="M8 7.2V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="8" cy="5.2" r="0.7" fill="currentColor" />
      </svg>
      {pos ? (
        <span
          className="deep-focus-info-tip__bubble"
          style={{ top: pos.top, right: pos.right }}
        >
          {TOOLTIP_TEXT}
        </span>
      ) : null}
    </span>
  );
}
