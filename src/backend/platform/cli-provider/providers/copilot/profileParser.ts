import type { AgentProfileParseResult } from '../../types.js';

const FRONTMATTER_LINE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

export function parseChatagentProfile(text: string): AgentProfileParseResult {
  const lines = text.split(/\r?\n/);
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstNonEmptyIndex < 0) {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile is empty.'],
    };
  }

  const firstNonEmptyLine = lines[firstNonEmptyIndex]!.trim();
  let frontmatterStart = firstNonEmptyIndex;
  let contentEnd: number | null = null;

  if (firstNonEmptyLine === '```chatagent') {
    frontmatterStart = firstNonEmptyIndex + 1;
    if (frontmatterStart >= lines.length || lines[frontmatterStart]!.trim() !== '---') {
      return {
        frontmatter: {},
        body: '',
        errors: ['Agent profile must include YAML frontmatter.'],
      };
    }
  } else if (firstNonEmptyLine !== '---') {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile must begin with YAML frontmatter or a ```chatagent fence.'],
    };
  } else {
    contentEnd = lines.length;
  }

  const frontmatterEnd = lines.findIndex((line, index) => index > frontmatterStart && line.trim() === '---');
  if (frontmatterEnd < 0) {
    return {
      frontmatter: {},
      body: '',
      errors: ['Agent profile frontmatter must close with ---.'],
    };
  }

  if (contentEnd === null) {
    const fenceEnd = lines.findIndex((line, index) => index > frontmatterEnd && line.trim() === '```');
    if (fenceEnd < 0) {
      return {
        frontmatter: {},
        body: '',
        errors: ['Agent profile must close the chatagent fence.'],
      };
    }
    contentEnd = fenceEnd;
  }

  const frontmatter: Record<string, string> = {};
  const errors: string[] = [];

  for (const rawLine of lines.slice(frontmatterStart + 1, frontmatterEnd)) {
    const stripped = rawLine.trim();
    if (!stripped) {
      continue;
    }
    const match = FRONTMATTER_LINE.exec(stripped);
    if (!match?.[1]) {
      errors.push(`Unsupported frontmatter line: ${stripped}`);
      continue;
    }
    frontmatter[match[1]] = (match[2] ?? '').trim();
  }

  return {
    frontmatter,
    name: frontmatter.name,
    description: frontmatter.description,
    model: frontmatter.model,
    body: lines.slice(frontmatterEnd + 1, contentEnd).join('\n').trim(),
    errors,
  };
}
