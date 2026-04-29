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
    expect(result).toContain('Writable roots define where implementation changes may be made.');
  });

  it('renders a distributed deep focus block for file focus with support and test metadata', () => {
    const result = buildFocusScopeBlock({
      estateType: 'distributed-platform',
      primaryFocusRelativePath: 'src/handler.ts',
      primaryFocusTargetKind: 'file',
      testTarget: { path: 'tests/unit', kind: 'directory' },
      writableRoots: [
        { path: 'src', kind: 'directory', reason: 'primary-focus-parent' },
        { path: 'tests/unit', kind: 'directory', reason: 'test-target' },
      ],
      readonlyContextRoots: [
        { path: 'src/shared', kind: 'directory', reason: 'support-target' },
        { path: 'docs/api.md', kind: 'file', reason: 'support-target' },
      ],
      supportTargets: [
        { path: 'src/shared', kind: 'directory', effectiveScope: 'full-directory' },
        { path: 'docs/api.md', kind: 'file', effectiveScope: 'exact-file' },
        { path: 'src', kind: 'directory', effectiveScope: 'directory-minus-primary' },
      ],
    });

    expect(result).toContain('## Deep Focus Scope');
    expect(result).toContain('Primary focus file: `src/handler.ts`');
    expect(result).toContain('Writable implementation roots:');
    expect(result).toContain('`src/` (primary focus parent)');
    expect(result).toContain('`tests/unit/` (test target)');
    expect(result).toContain('Read-only context roots:');
    expect(result).toContain('`src/shared/` (support target)');
    expect(result).toContain('`docs/api.md` (support target)');
    expect(result).not.toContain('only that exact file');
  });

  it('renders a monolith deep focus block with file focus, test, and support metadata', () => {
    const result = buildFocusScopeBlock({
      estateType: 'monolith',
      primaryFocusRelativePath: 'apps/api/routes/handler.ts',
      primaryFocusTargetKind: 'file',
      testTarget: { path: 'tests/api', kind: 'directory' },
      writableRoots: [
        { path: 'apps/api/routes', kind: 'directory', reason: 'primary-focus-parent' },
        { path: 'tests/api', kind: 'directory', reason: 'test-target' },
      ],
      readonlyContextRoots: [
        { path: 'shared/types.ts', kind: 'file', reason: 'support-target' },
      ],
      supportTargets: [
        { path: 'shared/types.ts', kind: 'file', effectiveScope: 'exact-file' },
        { path: 'apps/api', kind: 'directory', effectiveScope: 'directory-minus-primary' },
      ],
    });

    expect(result).toContain('## Monolith Focus Scope');
    expect(result).toContain('Primary focus file: `apps/api/routes/handler.ts`');
    expect(result).toContain('`apps/api/routes/` (primary focus parent)');
    expect(result).toContain('`tests/api/` (test target)');
    expect(result).toContain('`shared/types.ts` (support target)');
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
    expect(result).not.toContain('Writable roots define where implementation changes may be made.');
  });

  it('renders repo-root writable sentinel when no primary focus path is set', () => {
    const result = buildFocusScopeBlock({
      writableRoots: [{ path: '', kind: 'directory', reason: 'selected-primary' }],
    });
    expect(result).toContain('Primary focus path: `.`');
    expect(result).toContain('Writable implementation roots:');
    expect(result).toContain('`.` (selected primary)');
  });
});
