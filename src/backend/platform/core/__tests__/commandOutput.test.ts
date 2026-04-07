import { describe, expect, it } from 'vitest';

import { splitCommandOutputLines } from '../commandOutput.js';

describe('splitCommandOutputLines', () => {
  it('splits LF-delimited output', () => {
    expect(splitCommandOutputLines('a\nb\n')).toEqual(['a', 'b']);
  });

  it('splits CRLF-delimited output without leaving carriage returns behind', () => {
    expect(splitCommandOutputLines('src/app.ts\r\nsrc/web.tsx\r\n')).toEqual([
      'src/app.ts',
      'src/web.tsx',
    ]);
  });
});
