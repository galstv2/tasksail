// Dalton Verify — Verification Engineer — overlapping "D" and "V", masculine tint.

import type { CSSProperties } from 'react';

const DALTON_COLOR = 'var(--ts-brand-blue)';
const EDGE_GLOW = 'drop-shadow(0 0 2px currentColor)';
const GLOW_OPACITY = 0.38;

const GLYPH_STYLE: CSSProperties = {
  fontFamily: 'var(--ts-font-sans)',
  fontWeight: 700,
};

const D_GLYPH_PROPS = {
  x: 29,
  y: 34,
  textAnchor: 'middle' as const,
  dominantBaseline: 'central' as const,
  fontSize: 34,
  fill: 'currentColor',
};

const V_GLYPH_PROPS = {
  x: 40,
  y: 34,
  textAnchor: 'middle' as const,
  dominantBaseline: 'central' as const,
  fontSize: 34,
  fill: 'currentColor',
};

export function DaltonVerifySprite({ size = 36 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      style={{ color: DALTON_COLOR }}
    >
      <text {...V_GLYPH_PROPS} opacity={GLOW_OPACITY} style={{ ...GLYPH_STYLE, filter: EDGE_GLOW }}>
        V
      </text>
      <text {...D_GLYPH_PROPS} opacity={GLOW_OPACITY} style={{ ...GLYPH_STYLE, filter: EDGE_GLOW }}>
        D
      </text>
      <text {...V_GLYPH_PROPS} opacity={0.62} style={GLYPH_STYLE}>
        V
      </text>
      <text {...D_GLYPH_PROPS} style={GLYPH_STYLE}>
        D
      </text>
    </svg>
  );
}
