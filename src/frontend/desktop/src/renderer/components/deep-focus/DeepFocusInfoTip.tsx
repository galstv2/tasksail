import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_TEXT =
  'Deep Focus lets you narrow down exactly which folders and files your agents can see. Turn it off to use the top-level repos and folders you select instead.';

const BUBBLE_WIDTH = 220;
const VIEWPORT_PAD = 10;

type Position = { top: number; left: number; caretLeft: number; flipped: boolean };

function clampToViewport(
  iconRect: DOMRect,
): Position {
  const spaceBelow = window.innerHeight - iconRect.bottom - VIEWPORT_PAD;
  const bubbleHeight = 80; // conservative estimate for clamping
  const flipped = spaceBelow < bubbleHeight;

  const top = flipped
    ? iconRect.top - bubbleHeight - 8
    : iconRect.bottom + 8;

  // Centre the bubble on the icon, then clamp to viewport edges.
  const iconCentreX = iconRect.left + iconRect.width / 2;
  const idealLeft = iconCentreX - BUBBLE_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_PAD,
    Math.min(idealLeft, window.innerWidth - BUBBLE_WIDTH - VIEWPORT_PAD),
  );

  // Caret tracks the icon centre relative to the bubble's left edge.
  const caretLeft = Math.max(12, Math.min(iconCentreX - left, BUBBLE_WIDTH - 12));

  return { top, left, caretLeft, flipped };
}

export function DeepFocusInfoTip(): JSX.Element {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  const show = useCallback(() => {
    const el = iconRef.current;
    if (!el) return;
    setPos(clampToViewport(el.getBoundingClientRect()));
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
      {pos
        ? createPortal(
            <span
              className={
                'deep-focus-info-tip__bubble'
                + (pos.flipped ? ' deep-focus-info-tip__bubble--above' : '')
              }
              style={{
                top: pos.top,
                left: pos.left,
                width: BUBBLE_WIDTH,
                '--_caret-left': `${pos.caretLeft}px`,
              } as React.CSSProperties}
            >
              {TOOLTIP_TEXT}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
