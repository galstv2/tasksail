import { describe, it, expect } from 'vitest';
import {
  extractTaskTitle,
  templateMetadataLine,
  extractLineageValue,
  extractTaskMetadataValue,
  printTaskMetadataBlock,
  printTaskLineageBlock,
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
