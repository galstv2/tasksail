import { describe, it, expect } from 'vitest';
import {
  extractTaskTitle,
  templateMetadataLine,
  extractLineageValue,
  extractTaskMetadataValue,
  printTaskMetadataBlock,
  printTaskLineageBlock,
  extractContextPackBinding,
  formatContextPackBindingSection,
} from '../markdown.js';

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

describe('context pack binding markdown', () => {
  it('formats and extracts Deep Focus binding metadata', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
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
    expect(extractContextPackBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: { path: 'tests/orders', kind: 'directory' },
      selectedSupportTargets: [{ path: 'docs/orders.md', kind: 'file' }],
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
    expect(extractContextPackBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
    });
  });

  it('preserves repo-root Deep Focus binding metadata without fabricating a target kind', () => {
    const section = formatContextPackBindingSection({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
    });
    const content = `# Task

${section}

## Request Summary

Body
`;

    expect(extractContextPackBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: '',
      selectedFocusTargetKind: undefined,
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

    expect(extractContextPackBinding(content)).toEqual({
      contextPackDir: '/packs/orders',
      contextPackId: 'orders',
      scopeMode: 'focused',
      selectedRepoIds: ['backend'],
      selectedFocusIds: ['api'],
      deepFocusEnabled: true,
      selectedFocusPath: 'src/orders',
      selectedFocusTargetKind: 'directory',
      selectedTestTarget: null,
      selectedSupportTargets: [],
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
    expect(extractContextPackBinding(`# Task\n\n${section}\n`)).toMatchObject({
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

    expect(extractContextPackBinding(`# Task\n\n${section}\n`)).toMatchObject({
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

    const binding = extractContextPackBinding(`# Task\n\n${section}\n`);
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

    const binding = extractContextPackBinding(`# Task\n\n${section}\n`);
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

    const binding = extractContextPackBinding(`# Task\n\n${section}\n`);
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
