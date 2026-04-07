import { describe, expect, it } from 'vitest';

import { getRequiredTools } from '../localSetup.js';

describe('getRequiredTools', () => {
  it('probes python on Windows', () => {
    expect(getRequiredTools('win32')).toEqual(
      expect.arrayContaining([
        { name: 'python', checkCmd: ['python', '--version'] },
      ]),
    );
  });

  it('probes python3 on non-Windows platforms', () => {
    expect(getRequiredTools('linux')).toEqual(
      expect.arrayContaining([
        { name: 'python3', checkCmd: ['python3', '--version'] },
      ]),
    );
  });
});
