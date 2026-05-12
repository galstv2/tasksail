import { describe, expect, it } from 'vitest';
import { parseChatagentProfile } from '../profileParser.js';

function parseValue(line: string) {
  return parseChatagentProfile(`---
${line}
---

Body`);
}

describe('parseChatagentProfile', () => {
  it.each([
    ['name: Alice', 'Alice', 0],
    ['name: "Alice"', 'Alice', 0],
    ["name: 'Alice'", 'Alice', 0],
    ['model: "gpt-5.4"', 'gpt-5.4', 0],
  ])('sanitizes %s', (line, value, errorCount) => {
    const result = parseValue(line);

    const key = line.split(':')[0]!;
    expect(result.frontmatter[key]).toBe(value);
    expect(result.errors).toHaveLength(errorCount);
  });

  it('preserves unmatched quoted values and reports a parse error', () => {
    const result = parseValue('name: "Alice');

    expect(result.frontmatter.name).toBe('"Alice');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unmatched quote');
  });
});
