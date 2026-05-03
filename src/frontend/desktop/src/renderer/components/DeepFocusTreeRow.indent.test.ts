import { describe, expect, it } from 'vitest';
import { computeRowIndentPx } from './DeepFocusTreeRow';

describe('computeRowIndentPx', () => {
  it('uses the full 16px step for the first six levels', () => {
    expect(computeRowIndentPx(0)).toBe(0);
    expect(computeRowIndentPx(1)).toBe(16);
    expect(computeRowIndentPx(3)).toBe(48);
    expect(computeRowIndentPx(6)).toBe(96);
  });

  it('switches to a 6px step past depth 6 to keep deep trees readable', () => {
    expect(computeRowIndentPx(7)).toBe(96 + 6);
    expect(computeRowIndentPx(10)).toBe(96 + 4 * 6);
  });

  it('caps the indent so row content never disappears at extreme depths', () => {
    expect(computeRowIndentPx(20)).toBe(168);
    expect(computeRowIndentPx(50)).toBe(168);
  });
});
