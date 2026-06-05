import { describe, it, expect, vi } from 'vitest';
import {
  extractTaskTitle,
  templateMetadataLine,
  extractLineageValue,
  extractTaskMetadataValue,
  printTaskMetadataBlock,
  printTaskLineageBlock,
  extractContextPackBinding,
  formatAgentVisibleContextPackBindingSection,
  formatContextPackBindingSection,
} from '../markdown.js';
import { normalizeSelectedRepoPathsInText } from '../taskVisiblePathNormalization.js';

function expectBinding(content: string) {
  const result = extractContextPackBinding(content);
  expect(result.kind).toBe('binding');
  return result.kind === 'binding' ? result.binding : null;
}

describe('extractTaskTitle', () => {
  it('extracts the H1 heading text', () => {
    const content = '# My Task Title\n\nSome body text.';
    expect(extractTaskTitle(content)).toBe('My Task Title');
  });

  it('returns empty string if no H1 heading exists', () => {
    const content = '## Not an H1\n\nBody text.';
    expect(extractTaskTitle(content)).toBe('');
  });

  it('trims surrounding whitespace from the heading', () => {
    const content = '#   Spaced Title  \n\nBody.';
    expect(extractTaskTitle(content)).toBe('Spaced Title');
  });

  it('accepts tab spacing and removes a trailing ATX close run', () => {
    expect(extractTaskTitle('#\tSpaced Title ##\n\nBody.')).toBe('Spaced Title');
  });
});

describe('templateMetadataLine', () => {
  it('formats a label with a value', () => {
    expect(templateMetadataLine('Task ID', 'abc-123')).toBe(
      '- Task ID: abc-123',
    );
  });

  it('formats a label without a value', () => {
    expect(templateMetadataLine('Task ID')).toBe('- Task ID:');
  });

  it('formats a label with empty string as no value', () => {
    expect(templateMetadataLine('Task ID', '')).toBe('- Task ID:');
  });
});

describe('extractLineageValue', () => {
  const content = `# Task

## Task Lineage

- Task Kind: child-task
- Parent Task ID: parent-123
- Root Task ID: root-456
- Follow-Up Reason: needs adjustment

## Other Section

Some content.
`;

  it('extracts Task Kind from the lineage section', () => {
    expect(extractLineageValue(content, 'Task Kind')).toBe('child-task');
  });

  it('accepts tolerant section headings and strips HTML comments from values', () => {
    const tolerant = `# Task

##\tTask Lineage ##

- Task Kind: child-task <!-- old -->

## Other Section
`;
    expect(extractLineageValue(tolerant, 'Task Kind')).toBe('child-task');
  });

  it('returns the first duplicate label value and warns once per call', () => {
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const duplicate = `# Task

## Task Lineage

- Task Kind: child-task
- Task Kind: standard
- Task Kind: follow-up
`;
      expect(extractLineageValue(duplicate, 'Task Kind')).toBe('child-task');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('markdown.label.duplicate');
      expect(String(warn.mock.calls[0]?.[0])).toContain('Task Kind');
      expect(String(warn.mock.calls[0]?.[0])).toContain('Task Lineage');
    } finally {
      warn.mockRestore();
    }
  });

  it('extracts Parent Task ID', () => {
    expect(extractLineageValue(content, 'Parent Task ID')).toBe('parent-123');
  });

  it('returns empty string for a missing label', () => {
    expect(extractLineageValue(content, 'Nonexistent Label')).toBe('');
  });
});

describe('extractTaskMetadataValue', () => {
  const content = `# Task

## Task Metadata

- Task ID: my-task-001
- Task Title: Sample Task
- Initialized At (UTC): 2025-01-15T10:00:00Z

## Other Section
`;

  it('extracts Task ID', () => {
    expect(extractTaskMetadataValue(content, 'Task ID')).toBe('my-task-001');
  });

  it('extracts Task Title', () => {
    expect(extractTaskMetadataValue(content, 'Task Title')).toBe('Sample Task');
  });
});

describe('printTaskMetadataBlock', () => {
  it('formats key-value pairs as metadata lines', () => {
    const result = printTaskMetadataBlock({
      'Task ID': 'abc',
      'Task Title': 'My Task',
    });
    expect(result).toBe('- Task ID: abc\n- Task Title: My Task');
  });
});

describe('printTaskLineageBlock', () => {
  it('formats key-value pairs as lineage lines', () => {
    const result = printTaskLineageBlock({
      'Task Kind': 'standard',
      'Parent Task ID': '',
    });
    expect(result).toBe('- Task Kind: standard\n- Parent Task ID:');
  });
});

describe('normalizeSelectedRepoPathsInText', () => {
  it('normalizes human-readable selected roots and nested paths without overmatching siblings', () => {
    const text = 'Use /repo/tools and /repo/tools/Acme.Cli, but not /repo/toolshed.';
    expect(normalizeSelectedRepoPathsInText({
      text,
      aliases: [{ repoId: 'tools', originalRoot: '/repo/tools' }],
      mode: 'human-readable',
    })).toBe('Use tools and tools/Acme.Cli, but not /repo/toolshed.');
  });

  it('normalizes agent-executable selected roots to worktree paths', () => {
    expect(normalizeSelectedRepoPathsInText({
      text: 'Run from /repo/tools/Acme.Cli',
      aliases: [{ repoId: 'tools', originalRoot: '/repo/tools', worktreeRoot: '/task/worktrees/tools' }],
      mode: 'agent-executable',
    })).toBe('Run from /task/worktrees/tools/Acme.Cli');
  });
});

describe('context pack binding markdown', () => {
  it('returns absent when the Context Pack Binding section is missing or blank', () => {
    expect(extractContextPackBinding('# Task\n\nBody')).toEqual({ kind: 'absent' });
    expect(extractContextPackBinding('# Task\n\n## Context Pack Binding\n\n## Request Summary\n')).toEqual({ kind: 'absent' });
  });

  it('returns invalid when Context Pack Dir is missing', () => {
    expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir:
`)).toMatchObject({
      kind: 'invalid',
      reason: 'missing-context-pack-dir',
    });
  });

  it('SEC-TS-04: returns invalid when Context Pack Dir is a relative traversal', () => {
    expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir: ../../outside
`)).toMatchObject({
      kind: 'invalid',
      reason: 'unsafe-context-pack-dir',
    });
    // Absolute (external pack) and contained-relative dirs are NOT rejected.
    expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
`)).toMatchObject({ kind: 'binding' });
    expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir: contextpacks/mypack
`)).toMatchObject({ kind: 'binding' });
  });

  it('formats and parses Selection Roles with stable key ordering for standard mode', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'repo-selection',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      repositoryTypes: { tools: 'primary', platform: 'primary' },
    });

    expect(section).toContain('- Selection Roles: {"platform":"primary","tools":"primary"}');
    expect(expectBinding(section)).toMatchObject({
      repositoryTypes: { platform: 'primary', tools: 'primary' },
    });
  });

  it('rejects malformed Selection Roles fields', () => {
    for (const value of ['not-json', '[]', '{"platform":"writer"}', '{"":"primary"}']) {
      expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Selected Repo IDs: platform
- Selection Roles: ${value}
`)).toMatchObject({ kind: 'invalid', reason: 'malformed-repository-types' });
    }
  });

  it('returns invalid when selected focus targets are malformed', () => {
    expect(extractContextPackBinding(`# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Deep Focus Enabled: true
- Selected Focus Targets: {"path":"src"}
`)).toMatchObject({
      kind: 'invalid',
      reason: 'malformed-deep-focus',
    });
  });

  it('formats and extracts Deep Focus binding metadata', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          repoLocalPath: '/repos/backend',
          repoId: 'backend',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
          supportTargets: [],
        },
        {
          path: 'Acme.Seed',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'primary',
          supportTargets: [{ path: 'docs/seed.md', kind: 'file' }],
        },
      ],
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });
    const content = `# Task

${section}

## Request Summary

Body
`;

    expect(section).toContain('- Deep Focus Enabled: true');
    expect(section).toContain('- Selected Test Target: {"path":"tests/orders","kind":"directory"}');
    expect(section).toContain('- Selected Support Targets: [{"path":"docs/orders.md","kind":"file"}]');
    // Deep focus suppresses these; the operator's selection is fully encoded in
    // Selected Focus Targets with role markers.
    expect(section).not.toContain('- Primary Repo ID:');
    expect(section).not.toContain('- Selected Focus IDs:');
    expect(expectBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'src/orders',
          kind: 'directory',
          repoLocalPath: '/repos/backend',
          repoId: 'backend',
          role: 'anchor',
          testTarget: { path: 'tests/orders', kind: 'directory' },
          supportTargets: [],
        },
        {
          path: 'Acme.Seed',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'primary',
          supportTargets: [{ path: 'docs/seed.md', kind: 'file' }],
        },
      ],
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
    });
  });

  it('formats Deep Focus multi-primary task-visible metadata without repoLocalPath or scalar collapse', () => {
    const section = formatAgentVisibleContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      selectedFocusPath: 'libs',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [
        {
          path: 'libs',
          kind: 'directory',
          repoLocalPath: '/repos/platform',
          repoId: 'platform',
          role: 'anchor',
          supportTargets: [],
        },
        {
          path: 'Acme.Cli',
          kind: 'directory',
          repoLocalPath: '/repos/tools',
          repoId: 'tools',
          role: 'primary',
          supportTargets: [],
        },
      ],
    });

    expect(section).toContain('- Selected Repo IDs: platform, tools');
    expect(section).not.toContain('- Deep Focus Primary Repo ID:');
    expect(section).not.toContain('- Selected Focus Path:');
    expect(section).not.toContain('- Selected Focus Target Kind:');
    expect(section).not.toContain('repoLocalPath');
    expect(section).not.toContain('/repos/platform');
    expect(section).not.toContain('/repos/tools');
    const parsed = expectBinding(`# Task\n\n${section}\n\n## Request Summary\n\nBody`);
    expect(parsed?.selectedFocusTargets).toEqual([
      { path: 'libs', kind: 'directory', repoId: 'platform', role: 'anchor', supportTargets: [] },
      { path: 'Acme.Cli', kind: 'directory', repoId: 'tools', role: 'primary', supportTargets: [] },
    ]);
  });

  it('skips Selected Repo IDs when empty (monolith case) and round-trips back to []', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/crud-app-repo-dotnet',
      contextPackId: 'crud-app-repo-dotnet',
      scopeMode: 'standard',
      selectedRepoIds: [],
      selectedFocusIds: ['platform-service'],
      primaryFocusId: 'platform-service',
    });

    expect(section).not.toContain('- Selected Repo IDs:');
    expect(section).toContain('- Primary Focus ID: platform-service');
    expect(section).toContain('- Selected Focus IDs: platform-service');

    const content = `# Task\n\n${section}\n\n## Request Summary\n\nBody\n`;
    expect(expectBinding(content)).toMatchObject({
      contextPackId: 'crud-app-repo-dotnet',
      selectedRepoIds: [],
      selectedFocusIds: ['platform-service'],
      primaryFocusId: 'platform-service',
    });
  });

  it('round-trips Deep Focus Primary identifiers', () => {
    const formatted = formatContextPackBindingSection({
      contextPackDir: '/abs/pack',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      deepFocusPrimaryRepoId: 'platform',
      deepFocusPrimaryFocusId: 'orders-api',
      selectedFocusPath: '',
      selectedFocusTargets: [],
      selectedSupportTargets: [],
    });

    const parsed = extractContextPackBinding(formatted);
    expect(parsed).toMatchObject({
      kind: 'binding',
      binding: {
        deepFocusEnabled: true,
        deepFocusPrimaryRepoId: 'platform',
        deepFocusPrimaryFocusId: 'orders-api',
      },
    });
  });

  it('keeps legacy binding output unchanged when Deep Focus is disabled', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
    });
    const content = `# Task

${section}

## Request Summary

Body
`;

    expect(section).not.toContain('Deep Focus Enabled');
    expect(expectBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
    });
  });

  it('round-trips distributed primary repo binding metadata', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    });

    expect(section).toContain('- Primary Repo ID: platform\n- Selected Repo IDs: platform, tools');
    expect(expectBinding(`# Task\n\n${section}\n`)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
    });
  });

  it('parses empty and missing primary fields as absent', () => {
    expect(expectBinding(`# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: focused
- Primary Repo ID:
- Selected Repo IDs: platform
- Selected Focus IDs:
`)).not.toHaveProperty('primaryRepoId');

    expect(expectBinding(`# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: focused
- Selected Repo IDs: platform
- Selected Focus IDs:
`)).not.toHaveProperty('primaryRepoId');
  });

  it('preserves repo-root Deep Focus binding metadata without fabricating a target kind', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: '',
    });
    const content = `# Task

${section}

## Request Summary

Body
`;

    expect(expectBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: [],
      deepFocusEnabled: true,
      selectedFocusPath: '',
      selectedFocusTargetKind: undefined,
      selectedFocusTargets: [],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });
  });

  it('fails open while parsing malformed Deep Focus JSON', () => {
    const content = `# Task

## Context Pack Binding

- Context Pack Dir: /packs/orders
- Context Pack ID: orders
- Scope Mode: focused
- Selected Repo IDs: backend
- Selected Focus IDs: api
- Deep Focus Enabled: true
- Selected Focus Path: src/orders
- Selected Focus Target Kind: directory
- Selected Test Target: {"path":"tests/orders"
- Selected Support Targets: not-json

## Request Summary

Body
`;

    expect(extractContextPackBinding(content)).toMatchObject({
      kind: 'invalid',
      reason: 'malformed-targets',
    });
  });

  it('round-trips nested and global Deep Focus targets', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
      selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/shared.md', kind: 'file' }],
    });

    expect(section).toContain('"testTarget":{"path":"tests/orders","kind":"directory"}');
    expect(section).toContain('"supportTargets":[{"path":"docs/orders.md","kind":"file"}]');
    expect(expectBinding(`# Task\n\n${section}\n`)).toMatchObject({
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
      selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/shared.md', kind: 'file' }],
    });
  });

  it('round-trips nested-only Deep Focus targets', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
    });

    expect(expectBinding(`# Task\n\n${section}\n`)).toMatchObject({
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        testTarget: { path: 'tests/orders', kind: 'directory' },
        supportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
      }],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });
  });

  it('round-trips global-only Deep Focus targets and reads missing scoped fields as empty', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{ path: 'src/orders', kind: 'directory', role: 'anchor' }],
      selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/shared.md', kind: 'file' }],
    });

    const binding = expectBinding(`# Task\n\n${section}\n`);
    expect(binding).toMatchObject({
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [],
      }],
      selectedTestTarget: { path: 'tests/shared', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/shared.md', kind: 'file' }],
    });
    expect(binding?.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });

  it('round-trips Deep Focus targets with no nested or global fields', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedFocusTargets: [{ path: 'src/orders', kind: 'directory', role: 'anchor' }],
    });

    const binding = expectBinding(`# Task\n\n${section}\n`);
    expect(binding).toMatchObject({
      selectedFocusTargets: [{
        path: 'src/orders',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [],
      }],
      selectedTestTarget: null,
      selectedSupportTargets: [],
    });
    expect(binding?.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });

  it('round-trips repo-root primary with no scoped fields', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
      selectedFocusTargets: [{ path: '', kind: 'directory', role: 'anchor' }],
    });

    const binding = expectBinding(`# Task\n\n${section}\n`);
    expect(binding).toMatchObject({
      selectedFocusPath: '',
      selectedFocusTargets: [{
        path: '',
        kind: 'directory',
        role: 'anchor',
        supportTargets: [],
      }],
    });
    expect(binding?.selectedFocusTargets?.[0]?.testTarget).toBeUndefined();
  });
});
