import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { RonSprite } from './RonSprite';
import { agentSpriteMap } from './index';

describe('agent sprites', () => {
  it.each([
    ['LilySprite', LilySprite],
    ['AliceSprite', AliceSprite],
    ['DaltonSprite', DaltonSprite],
    ['RonSprite', RonSprite],
  ])('%s renders an SVG with crispEdges', (_name, Sprite) => {
    const { container } = render(<Sprite size={40} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('40');
    expect(svg?.getAttribute('height')).toBe('40');
    expect(svg?.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.querySelectorAll('rect').length).toBeGreaterThan(20);
  });

  it('agentSpriteMap covers all four named agents', () => {
    expect(Object.keys(agentSpriteMap)).toEqual(
      expect.arrayContaining(['planning-agent', 'product-manager', 'software-engineer', 'qa']),
    );
    expect(Object.keys(agentSpriteMap)).toHaveLength(4);
  });

  it('each sprite renders at a custom size', () => {
    const { container } = render(<LilySprite size={64} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });
});
