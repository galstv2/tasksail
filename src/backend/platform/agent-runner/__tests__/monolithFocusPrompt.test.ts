import { describe, expect, it } from 'vitest';
import { buildMonolithFocusScopeBlock } from '../pipeline/monolithFocusPrompt.js';

describe('buildMonolithFocusScopeBlock', () => {
  it('returns undefined when primaryFocusRelativePath is undefined', () => {
    expect(buildMonolithFocusScopeBlock(undefined)).toBeUndefined();
  });

  it('returns undefined when primaryFocusRelativePath is empty string', () => {
    expect(buildMonolithFocusScopeBlock('')).toBeUndefined();
  });

  it('returns undefined when primaryFocusRelativePath is whitespace-only', () => {
    expect(buildMonolithFocusScopeBlock('  ')).toBeUndefined();
  });

  it('returns the correct block with default options for a valid path', () => {
    const result = buildMonolithFocusScopeBlock('services/sink');
    expect(result).toBeDefined();
    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus path: `services/sink`');
    expect(result).toContain('Your launch CWD is already this folder.');
    expect(result).toContain('implementation changes must stay within the selected focus area.');
  });

  it('returns the correct block with custom launchContextLine and scopeLine', () => {
    const result = buildMonolithFocusScopeBlock('services/sink', {
      launchContextLine: 'Custom launch context.',
      scopeLine: 'Custom scope line.',
    });
    expect(result).toBeDefined();
    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus path: `services/sink`');
    expect(result).toContain('Custom launch context.');
    expect(result).toContain('Custom scope line.');
    expect(result).not.toContain('Your launch CWD is already this folder.');
    expect(result).not.toContain('implementation changes must stay within the selected focus area.');
  });
});
