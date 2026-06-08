import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlannerSprite } from './PlannerSprite';
import { ProductManagerSprite } from './ProductManagerSprite';
import { BuilderSprite } from './BuilderSprite';
import { VerifierSprite } from './VerifierSprite';
import { QaSprite } from './QaSprite';
import { roleKindSpriteMap } from './index';

describe('agent sprites', () => {
  it.each([
    ['PlannerSprite', PlannerSprite],
    ['ProductManagerSprite', ProductManagerSprite],
    ['BuilderSprite', BuilderSprite],
    ['VerifierSprite', VerifierSprite],
    ['QaSprite', QaSprite],
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
    ['PlannerSprite', PlannerSprite, 'P'],
    ['ProductManagerSprite', ProductManagerSprite, 'P'],
    ['BuilderSprite', BuilderSprite, 'B'],
    ['VerifierSprite', VerifierSprite, 'V'],
    ['QaSprite', QaSprite, 'Q'],
  ])('%s renders its capital identity letter', (_name, Sprite, letter) => {
    const { container } = render(<Sprite size={36} />);
    const letters = Array.from(container.querySelectorAll('text')).map((node) => node.textContent);
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.every((value) => value === letter)).toBe(true);
  });

  it('roleKindSpriteMap covers all role kinds', () => {
    expect(Object.keys(roleKindSpriteMap)).toEqual(
      expect.arrayContaining(['planner', 'pm', 'builder', 'verifier', 'qa']),
    );
    expect(Object.keys(roleKindSpriteMap)).toHaveLength(5);
  });

  it('each sprite renders at a custom size', () => {
    const { container } = render(<PlannerSprite size={64} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });
});
