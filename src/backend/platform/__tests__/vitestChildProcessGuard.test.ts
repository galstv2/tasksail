import { describe, expect, it } from 'vitest';
import { parseProcChildPids } from '../vitest.childProcessGuard.js';

describe('vitest child process guard', () => {
  it('parses Linux proc child pid lists without introducing observer children', () => {
    expect(parseProcChildPids('')).toEqual([]);
    expect(parseProcChildPids(' 123 456\n789 ')).toEqual(['123', '456', '789']);
  });
});
