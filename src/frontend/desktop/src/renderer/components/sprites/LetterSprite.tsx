// Agent identity badge: a single capital letter in the platform sans (Outfit),
// tinted by a gendered brand token with a thin edge glow. Color flows through
// `currentColor` — the svg's `color` is set to one --ts-brand-* token so both
// glyph and glow stay in sync without hardcoding hex.
//
// Glow technique: a duplicate "ghost" <text> carries the drop-shadow; the crisp
// <text> on top has no filter and no filtered ancestor, so Chromium renders it
// at native resolution (a filter on the <svg> itself would push the glyph into a
// compositing layer and soften it). The ghost's body is fully covered by the
// crisp copy, so only its shadow shows — a subtle halo along the outer edges.
// currentColor in drop-shadow() resolves in Chromium (Chrome 55+).

import type { CSSProperties } from 'react';

export type LetterSpriteGender = 'feminine' | 'masculine';

const GENDER_COLOR: Record<LetterSpriteGender, string> = {
  feminine: 'var(--ts-brand-burgundy-light)',
  masculine: 'var(--ts-brand-blue)',
};

// A single soft, wide halo kept FAINT (GLOW_OPACITY) so the crisp glyph's hard
// edge dominates and the glow reads as a subtle accent on the outline rather
// than a fog over the letter. Same hue as the glyph (a lighter tint would
// vanish on the light badge tile). Radius is in CSS px at render size.
const EDGE_GLOW = 'drop-shadow(0 0 2px currentColor)';
const GLOW_OPACITY = 0.38;

export function LetterSprite({
  size = 36,
  letter,
  gender,
}: {
  size?: number;
  letter: string;
  gender: LetterSpriteGender;
}): JSX.Element {
  const multi = letter.length > 1;
  const fontSize = multi ? 24 : 34;
  const glyphStyle: CSSProperties = {
    fontFamily: 'var(--ts-font-sans)',
    fontWeight: 700,
    ...(multi ? { letterSpacing: '-1px' } : {}),
  };
  const glyphProps = {
    x: 32,
    y: 34,
    textAnchor: 'middle' as const,
    dominantBaseline: 'central' as const,
    fontSize,
    fill: 'currentColor',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
      style={{ color: GENDER_COLOR[gender] }}
    >
      {/* Ghost glyph carries the glow; its body is covered by the crisp copy,
          so only the faint drop-shadow shows as a subtle outer-edge halo. */}
      <text {...glyphProps} opacity={GLOW_OPACITY} style={{ ...glyphStyle, filter: EDGE_GLOW }}>
        {letter}
      </text>
      {/* Crisp glyph: no filter, no filtered ancestor → native-resolution text. */}
      <text {...glyphProps} style={glyphStyle}>
        {letter}
      </text>
    </svg>
  );
}
