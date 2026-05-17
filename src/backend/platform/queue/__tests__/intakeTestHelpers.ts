import { expect } from 'vitest';

export const IMPLEMENTATION_SPEC_TEMPLATE = [
  '# Implementation Spec',
  '',
  '## Task Metadata',
  '',
  '- Task ID:',
  '',
  '## Intake Requirements',
  '<!-- Platform-generated from handoffs/intake.md during task activation. Do not edit or delete. Read handoffs/intake.md for the full request context; use this section as the canonical requirement spine for CR-*, COMP-*, and VAL-* items. -->',
  '',
  '## Problem and Outcome',
  '',
].join('\n');

export function sectionBetween(content: string, startHeading: string, endHeading: string): string {
  const start = content.indexOf(startHeading);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = start + startHeading.length;
  const end = content.indexOf(endHeading, bodyStart);
  expect(end).toBeGreaterThanOrEqual(0);
  return content.slice(bodyStart, end).replace(/^\n+|\n+$/g, '');
}
