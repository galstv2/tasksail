import { describe, expect, it } from 'vitest';

import { toTitleCase } from './toTitleCase';

describe('toTitleCase', () => {
  it('capitalizes the first character of a lowercase word', () => {
    expect(toTitleCase('hello')).toBe('Hello');
    expect(toTitleCase('Hello')).toBe('Hello');
  });

  it.each([
    { input: '', expected: '', label: 'empty string' },
    { input: 'a', expected: 'A', label: 'single character' },
    { input: 'hello world', expected: 'Hello world', label: 'multi-word' },
  ])('handles $label', ({ input, expected }) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});
