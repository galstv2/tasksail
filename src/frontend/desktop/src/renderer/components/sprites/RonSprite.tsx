// Ron — QA and Closeout — Blocky square head, neat dark hair wider than face, brass monocle/spectacle + chain, composed smile
// Palette: #b8b8d8 skin, #9898b8 shadow, #3a3a58 hair, #c8873a monocle, #1a1a2a eyes, #ffffff highlight, #9090b0 mouth

import { renderPixelGrid } from './renderPixelGrid';

const _ = null;
const S = '#b8b8d8';  // skin
const D = '#9898b8';  // shadow
const H = '#3a3a58';  // hair (dark slate-indigo)
const M = '#c8873a';  // monocle (brass)
const E = '#1a1a2a';  // eyes
const W = '#ffffff';  // highlight
const L = '#9090b0';  // mouth

const PIXELS: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 0
  [_, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _],  // 1  ← hair 1px wider than face
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 2
  [_, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _],  // 3  ← hair widest
  [_, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _],  // 4
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 5  ← face narrower than hair
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 6
  [_, _, _, _, D, S, S, S, S, S, S, S, S, M, M, M, S, S, S, S, D, _, _, _],  // 7  ← monocle top
  [_, _, _, _, D, S, S, S, S, S, S, S, M, S, S, S, M, S, S, S, D, _, _, _],  // 8  ← monocle ring
  [_, _, _, _, D, S, S, E, E, W, S, S, M, E, E, W, M, S, S, S, D, _, _, _],  // 9  ← eyes + lens
  [_, _, _, _, D, S, S, E, E, E, S, S, M, E, E, E, M, S, S, S, D, _, _, _],  // 10
  [_, _, _, _, D, S, S, S, S, S, S, S, M, S, S, S, M, S, S, S, D, _, _, _],  // 11 ← monocle ring
  [_, _, _, _, D, S, S, S, S, S, S, S, S, M, M, M, S, S, S, S, D, _, _, _],  // 12 ← monocle bottom
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, M, S, S, S, S, S, D, _, _, _],  // 13 ← chain
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 14
  [_, _, _, _, D, S, S, S, S, L, S, S, S, S, S, L, S, S, S, S, D, _, _, _],  // 15 ← smile corners
  [_, _, _, _, D, S, S, S, S, S, L, L, L, L, L, S, S, S, S, S, D, _, _, _],  // 16 ← smile curve
  [_, _, _, _, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, _, _, _],  // 17
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 18
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 19
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 20
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 21
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 22
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 23
];

export function RonSprite({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {renderPixelGrid(PIXELS)}
    </svg>
  );
}
