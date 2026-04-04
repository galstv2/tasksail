// Lily — Planning Specialist — Blocky square head, full straight auburn hair on sides, bangs, sparkle eyes, sweet smile
// Palette: #f5b8a8 skin, #daa090 shadow, #7a3030 hair, #1a1a2a eyes, #ffffff highlight, #f0a0a0 blush, #d4707a mouth

import { renderPixelGrid } from './renderPixelGrid';

const _ = null;
const S = '#f5b8a8';  // skin
const D = '#daa090';  // shadow
const H = '#7a3030';  // hair (dark auburn)
const E = '#1a1a2a';  // eyes
const W = '#ffffff';  // highlight / sparkle
const B = '#f0a0a0';  // blush
const L = '#d4707a';  // mouth

const PIXELS: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 0
  [_, _, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _, _],  // 1
  [_, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _],  // 2
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 3
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 4
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 5  ← bangs
  [_, _, _, H, H, H, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _, _],  // 6
  [_, _, _, H, H, H, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _, _],  // 7
  [_, _, _, H, H, H, S, S, E, W, S, S, S, S, E, W, S, S, H, H, H, _, _, _],  // 8  ← sparkle eyes
  [_, _, _, H, H, H, S, S, W, E, S, S, S, S, W, E, S, S, H, H, H, _, _, _],  // 9
  [_, _, _, H, H, H, S, S, E, E, S, S, S, S, E, E, S, S, H, H, H, _, _, _],  // 10
  [_, _, _, H, H, H, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _, _],  // 11
  [_, _, _, H, H, H, B, S, S, S, S, S, S, S, S, S, S, B, H, H, H, _, _, _],  // 12
  [_, _, _, H, H, H, S, S, S, L, S, S, S, S, L, S, S, S, H, H, H, _, _, _],  // 13 ← smile corners
  [_, _, _, H, H, H, S, S, S, S, L, L, L, L, S, S, S, S, H, H, H, _, _, _],  // 14 ← smile curve
  [_, _, _, H, H, H, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _, _],  // 15
  [_, _, _, H, H, H, D, D, D, D, D, D, D, D, D, D, D, D, H, H, H, _, _, _],  // 16
  [_, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _],  // 17
  [_, _, _, H, H, H, _, _, _, _, _, _, _, _, _, _, _, _, H, H, H, _, _, _],  // 18 ← straight hair down
  [_, _, _, _, H, H, _, _, _, _, _, _, _, _, _, _, _, _, H, H, _, _, _, _],  // 19
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 20
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 21
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 22
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 23
];

export function LilySprite({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {renderPixelGrid(PIXELS)}
    </svg>
  );
}
