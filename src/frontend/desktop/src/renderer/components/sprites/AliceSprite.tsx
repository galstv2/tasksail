// Alice — Product Manager — Wide blocky head, Velma-style round glasses, full side-swept blonde hair, fair skin, cute smile
// Palette: #fce4d0 skin, #e8c8b0 shadow, #c8a050 hair, #484858 glasses, #2a2a3a eyes, #ffffff highlight, #f0b0a0 blush, #e09080 mouth, #d4a888 freckles

import { renderPixelGrid } from './renderPixelGrid';

const _ = null;
const S = '#fce4d0';  // skin (fair/light)
const D = '#e8c8b0';  // shadow
const H = '#c8a050';  // hair (warm blonde)
const G = '#5a5a70';  // glasses (steel)
const F = '#8a6a5a';  // beauty mark
const E = '#2a2a3a';  // eyes (dark, reads as pupil)
const W = '#ffffff';  // highlight
const B = '#f0b0a0';  // blush
const L = '#e09080';  // mouth

const PIXELS: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 0
  [_, _, _, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _],  // 1
  [_, _, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 2
  [_, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _],  // 3
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _],  // 4
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _],  // 5
  [_, _, _, _, H, S, S, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _],  // 6  ← 1px hair left, 3px right
  [_, _, _, _, H, S, S, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _],  // 7
  [_, _, _, _, H, S, S, G, G, G, G, G, S, G, G, G, G, G, S, H, H, H, _, _],  // 8  ← frames top rim + bridge
  [_, _, _, _, H, S, G, S, W, E, S, G, S, S, W, E, S, G, S, H, H, H, _, _],  // 9  ← lens: skin + eye inside frame
  [_, _, _, _, H, S, G, S, E, E, S, G, S, S, E, E, S, G, S, H, H, H, _, _],  // 10 ← lens: skin + pupil
  [_, _, _, _, H, S, S, G, G, G, G, S, S, G, G, G, G, S, S, H, H, H, _, _],  // 11 ← frames bottom rim
  [_, _, _, _, H, S, S, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _],  // 12
  [_, _, _, _, H, S, S, S, S, S, S, S, S, S, S, S, F, S, S, H, H, H, _, _],  // 13 ← beauty mark right cheek
  [_, _, _, _, H, B, S, S, S, L, S, S, S, S, L, S, S, S, B, H, H, H, _, _],  // 14 ← blush + smile corners
  [_, _, _, _, H, S, S, S, S, S, L, L, L, L, S, S, S, S, S, H, H, H, _, _],  // 15 ← smile curve
  [_, _, _, _, H, S, S, S, S, S, S, S, S, S, S, S, S, S, S, H, H, H, _, _],  // 16
  [_, _, _, _, H, D, D, D, D, D, D, D, D, D, D, D, D, D, D, H, H, H, _, _],  // 17
  [_, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _],  // 18
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, H, H, H, _, _, _],  // 19
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, H, H, _, _, _],  // 20
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 21
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 22
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 23
];

export function AliceSprite({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {renderPixelGrid(PIXELS)}
    </svg>
  );
}
