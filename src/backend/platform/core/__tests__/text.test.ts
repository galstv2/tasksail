import { describe, it, expect } from 'vitest';
import {
  stripWrappingQuotes,
  slugify,
  jsonEscapeString,
  extractFrontmatter,
  extractMarkdownSection,
} from '../text.js';

describe('stripWrappingQuotes', () => {
  it('strips double quotes', () => {
    expect(stripWrappingQuotes('"hello"')).toBe('hello');
  });

  it('strips single quotes', () => {
    expect(stripWrappingQuotes("'hello'")).toBe('hello');
  });

  it('leaves unquoted strings unchanged', () => {
    expect(stripWrappingQuotes('hello')).toBe('hello');
  });

  it('does not strip mismatched quotes', () => {
    expect(stripWrappingQuotes('"hello\'')).toBe('"hello\'');
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('Hello World!')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('a   b   c')).toBe('a-b-c');
  });

  it('uses default value for empty result', () => {
    expect(slugify('!!!')).toBe('task');
  });

  it('uses custom default value', () => {
    expect(slugify('!!!', 'fallback')).toBe('fallback');
  });
});

describe('jsonEscapeString', () => {
  it('escapes backslashes', () => {
    expect(jsonEscapeString('a\\b')).toBe('a\\\\b');
  });

  it('escapes double quotes', () => {
    expect(jsonEscapeString('a"b')).toBe('a\\"b');
  });

  it('escapes newlines', () => {
    expect(jsonEscapeString('a\nb')).toBe('a\\nb');
  });

  it('escapes tabs', () => {
    expect(jsonEscapeString('a\tb')).toBe('a\\tb');
  });
});

describe('extractFrontmatter', () => {
  it('extracts frontmatter from markdown', () => {
    const content = '---\ntitle: Test\n---\nBody content';
    const result = extractFrontmatter(content);
    expect(result.frontmatter).toBe('title: Test');
    expect(result.body).toBe('Body content');
  });

  it('returns null frontmatter when none present', () => {
    const result = extractFrontmatter('Just body content');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('Just body content');
  });
});

describe('extractMarkdownSection', () => {
  it('extracts a section body by heading name', () => {
    const content = '## Intro\nHello\n## Details\nWorld\n## End\nBye';
    expect(extractMarkdownSection(content, 'Details')).toBe('World');
  });

  it('returns empty string for missing section', () => {
    expect(extractMarkdownSection('## Other\nContent', 'Missing')).toBe('');
  });

  it('does not truncate section bodies at literal Z characters', () => {
    const content = '## Context Pack Binding\n- Context Pack Dir: /tmp/task-Ze/contextpacks/orders\n- Context Pack ID: orders';
    expect(extractMarkdownSection(content, 'Context Pack Binding')).toBe(
      '- Context Pack Dir: /tmp/task-Ze/contextpacks/orders\n- Context Pack ID: orders',
    );
  });
});
