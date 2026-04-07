import { describe, expect, it } from 'vitest';

import { COMMAND_LINE_PATTERN } from '../matching.js';

describe('COMMAND_LINE_PATTERN', () => {
  it('matches Windows-native command starters outside fenced blocks', () => {
    const commands = [
      'powershell -File scripts/check.ps1',
      'pwsh -Command Get-ChildItem',
      'cmd /c dir',
      '.\\scripts\\check.bat',
      'py -m pytest tests/domains/test_infra/test_script_lib.py',
    ];

    for (const command of commands) {
      expect(COMMAND_LINE_PATTERN.test(command)).toBe(true);
    }
  });

  it('does not treat plain prose as a command line', () => {
    expect(COMMAND_LINE_PATTERN.test('Validation should run in CI.')).toBe(false);
  });
});
