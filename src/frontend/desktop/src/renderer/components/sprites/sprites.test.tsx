import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { DaltonVerifySprite } from './DaltonVerifySprite';
import { RonSprite } from './RonSprite';
import { roleKindSpriteMap } from './index';

describe('agent sprites', () => {
  it.each([
    ['LilySprite', LilySprite],
    ['AliceSprite', AliceSprite],
    ['DaltonSprite', DaltonSprite],
    ['DaltonVerifySprite', DaltonVerifySprite],
    ['RonSprite', RonSprite],
  ])('%s renders an accessible SVG at the requested size', (_name, Sprite) => {
    const { container } = render(<Sprite size={36} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('36');
    expect(svg?.getAttribute('height')).toBe('36');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
  });

  it.each([
    ['LilySprite', LilySprite, 'L'],
    ['AliceSprite', AliceSprite, 'A'],
    ['DaltonSprite', DaltonSprite, 'D'],
    ['RonSprite', RonSprite, 'R'],
  ])('%s renders its capital identity letter', (_name, Sprite, letter) => {
    const { container } = render(<Sprite size={36} />);
    const letters = Array.from(container.querySelectorAll('text')).map((node) => node.textContent);
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.every((value) => value === letter)).toBe(true);
  });

  it('DaltonVerifySprite renders overlapping D and V glyphs with D in the foreground', () => {
    const { container } = render(<DaltonVerifySprite size={36} />);
    const letters = Array.from(container.querySelectorAll('text')).map((node) => node.textContent);
    expect(letters).toEqual(['V', 'D', 'V', 'D']);
  });

  it('roleKindSpriteMap covers all role kinds', () => {
    expect(Object.keys(roleKindSpriteMap)).toEqual(
      expect.arrayContaining(['planner', 'pm', 'builder', 'verifier', 'qa']),
    );
    expect(Object.keys(roleKindSpriteMap)).toHaveLength(5);
  });

  it('each sprite renders at a custom size', () => {
    const { container } = render(<LilySprite size={64} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });
});
