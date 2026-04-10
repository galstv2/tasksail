import { describe, expect, it } from 'vitest';
import { buildFocusScopeBlock } from '../pipeline/focusScopePrompt.js';

describe('buildFocusScopeBlock', () => {
  it('returns undefined when primaryFocusRelativePath is undefined', () => {
    expect(buildFocusScopeBlock()).toBeUndefined();
  });

  it('returns undefined when primaryFocusRelativePath is empty string', () => {
    expect(buildFocusScopeBlock({ primaryFocusRelativePath: '' })).toBeUndefined();
  });

  it('returns undefined when primaryFocusRelativePath is whitespace-only', () => {
    expect(buildFocusScopeBlock({ primaryFocusRelativePath: '  ' })).toBeUndefined();
  });

  it('returns the correct monolith block with default options for a valid path', () => {
    const result = buildFocusScopeBlock({ primaryFocusRelativePath: 'services/sink' });
    expect(result).toBeDefined();
    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus path: `services/sink/`');
    expect(result).toContain('Your launch CWD is already this folder.');
    expect(result).toContain('implementation changes must stay within the selected focus area.');
  });

  it('renders a distributed deep focus block for file focus with support and test metadata', () => {
    const result = buildFocusScopeBlock({
      estateType: 'distributed-platform',
      primaryFocusRelativePath: 'src/handler.ts',
      primaryFocusTargetKind: 'file',
      testTarget: { path: 'tests/unit', kind: 'directory' },
      supportTargets: [
        { path: 'src/shared', kind: 'directory', effectiveScope: 'full-directory' },
        { path: 'docs/api.md', kind: 'file', effectiveScope: 'exact-file' },
        { path: 'src', kind: 'directory', effectiveScope: 'directory-minus-primary' },
      ],
    });

    expect(result).toContain('## Deep Focus Scope');
    expect(result).toContain('Primary focus file: `src/handler.ts`');
    expect(result).toContain('Test target: `tests/unit/` — you may create and modify test files here.');
    expect(result).toContain('### Support context');
    expect(result).toContain('`src/shared/` (full directory)');
    expect(result).toContain('`docs/api.md` (exact file)');
    expect(result).toContain('`src/` excluding `src/handler.ts`');
  });

  it('renders a monolith deep focus block with file focus, test, and support metadata', () => {
    const result = buildFocusScopeBlock({
      estateType: 'monolith',
      primaryFocusRelativePath: 'apps/api/routes/handler.ts',
      primaryFocusTargetKind: 'file',
      testTarget: { path: 'tests/api', kind: 'directory' },
      supportTargets: [
        { path: 'shared/types.ts', kind: 'file', effectiveScope: 'exact-file' },
        { path: 'apps/api', kind: 'directory', effectiveScope: 'directory-minus-primary' },
      ],
    });

    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus file: `apps/api/routes/handler.ts`');
    expect(result).toContain('Test target: `tests/api/` — you may create and modify test files here.');
    expect(result).toContain('`shared/types.ts` (exact file)');
    expect(result).toContain('`apps/api/` excluding `apps/api/routes/handler.ts`');
  });

  it('returns the correct block with custom launchContextLine and scopeLine', () => {
    const result = buildFocusScopeBlock({
      primaryFocusRelativePath: 'services/sink',
      launchContextLine: 'Custom launch context.',
      scopeLine: 'Custom scope line.',
    });
    expect(result).toBeDefined();
    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus path: `services/sink/`');
    expect(result).toContain('Custom launch context.');
    expect(result).toContain('Custom scope line.');
    expect(result).not.toContain('Your launch CWD is already this folder.');
    expect(result).not.toContain('implementation changes must stay within the selected focus area.');
  });
});
