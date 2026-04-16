import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LilySprite } from './LilySprite';
import { AliceSprite } from './AliceSprite';
import { DaltonSprite } from './DaltonSprite';
import { DaltonVerifySprite } from './DaltonVerifySprite';
import { RonSprite } from './RonSprite';
import { agentSpriteMap } from './index';

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

  it('agentSpriteMap covers all named agents', () => {
    expect(Object.keys(agentSpriteMap)).toEqual(
      expect.arrayContaining(['planning-agent', 'product-manager', 'software-engineer', 'software-engineer-verify', 'qa']),
    );
    expect(Object.keys(agentSpriteMap)).toHaveLength(5);
  });

  it('each sprite renders at a custom size', () => {
    const { container } = render(<LilySprite size={64} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('64');
    expect(svg?.getAttribute('height')).toBe('64');
  });
});
