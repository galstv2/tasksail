// Dalton — Software Engineer — Blocky square head, spiky dark hair, headphone band, half-lidded eyes, smirk
// Palette: #f0c080 skin, #d0a060 shadow, #2a1a0a hair, #3a3a4a headphone, #1a1a2a eyes, #ffffff highlight, #c88060 mouth

import { renderPixelGrid } from './renderPixelGrid';

const _ = null;
const S = '#f0c080';  // skin
const D = '#d0a060';  // shadow
const H = '#2a1a0a';  // hair (very dark brown)
const P = '#3a3a4a';  // headphone
const E = '#1a1a2a';  // eyes
const W = '#ffffff';  // highlight
const L = '#c88060';  // mouth

const PIXELS: (string | null)[][] = [
  //0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
  [_, _, _, _, _, _, _, H, _, H, _, _, H, _, H, _, H, _, _, _, _, _, _, _],  // 0
  [_, _, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _, _],  // 1
  [_, _, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _, _],  // 2
  [_, _, _, _, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, H, _, _, _, _],  // 3
  [_, _, _, P, P, H, H, H, H, H, H, H, H, H, H, H, H, H, H, P, P, _, _, _],  // 4
  [_, _, _, P, P, H, S, S, S, S, S, S, S, S, S, S, S, S, H, P, P, _, _, _],  // 5
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 6
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 7
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 8
  [_, _, _, _, D, S, S, E, E, W, S, S, S, S, E, E, W, S, S, S, D, _, _, _],  // 9
  [_, _, _, _, D, S, S, E, E, E, S, S, S, S, E, E, E, S, S, S, D, _, _, _],  // 10
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 11
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 12
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, L, S, S, S, S, S, D, _, _, _],  // 13  ← smirk corner
  [_, _, _, _, D, S, S, S, S, S, S, L, L, L, S, S, S, S, S, S, D, _, _, _],  // 14  ← smirk curve
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 15
  [_, _, _, _, D, S, S, S, S, S, S, S, S, S, S, S, S, S, S, S, D, _, _, _],  // 16
  [_, _, _, _, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, D, _, _, _],  // 17
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 18
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 19
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 20
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 21
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 22
  [_, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _],  // 23
];

export function DaltonSprite({ size = 40 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {renderPixelGrid(PIXELS)}
    </svg>
  );
}
