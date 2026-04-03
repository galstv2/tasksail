import { describe, expect, it } from 'vitest';

import { classNames } from './classNames';

describe('classNames', () => {
  it('joins multiple string arguments', () => {
    expect(classNames('a', 'b', 'c')).toBe('a b c');
  });

  it.each([
    { args: ['a', false, 'b'] as const, expected: 'a b', label: 'false' },
    { args: ['a', null, 'b'] as const, expected: 'a b', label: 'null' },
    { args: ['a', undefined, 'b'] as const, expected: 'a b', label: 'undefined' },
    { args: [false, 'only', null, undefined] as const, expected: 'only', label: 'mixed falsy' },
    { args: [false, null, undefined] as const, expected: '', label: 'all falsy' },
    { args: [] as const, expected: '', label: 'no arguments' },
  ])('filters $label values', ({ args, expected }) => {
    expect(classNames(...args)).toBe(expected);
  });
});
