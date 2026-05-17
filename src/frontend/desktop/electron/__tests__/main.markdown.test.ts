import { describe, expect, it } from 'vitest';
import {
  canonicalizeRequirementSection,
  parsePlannerEditableDraft,
} from '../main.markdown';

function buildDraft(routingValue: string): string {
  return [
    '## Request Summary',
    'Operator wants the thing done.',
    '',
    '## Desired Outcome',
    'The thing is done.',
    '',
    '## Constraints',
    'None',
    '',
    '## Critical Requirements',
    '- Preserve exact behavior.',
    '',
    '## Compatibility Requirements',
    '- Existing callers keep working.',
    '',
    '## Required Validation',
    'Run the focused tests.',
    '',
    '## Acceptance Signals',
    '- The thing is verifiably done.',
    '',
    '## Parent Task Carry-Forward Summary',
    '',
    '## Suggested Routing',
    `- Recommended Execution: ${routingValue}`,
    '- Planner Notes: Lean ask; no extra slices needed.',
    '',
  ].join('\n');
}

describe('parsePlannerEditableDraft — Recommended Execution vocabulary', () => {
  it('accepts Lily-flow vocab "sequential"', () => {
    const draft = parsePlannerEditableDraft(buildDraft('sequential'));
    expect(draft.suggestedPath).toBe('sequential');
  });

  it('accepts Lily-flow vocab "parallel"', () => {
    const draft = parsePlannerEditableDraft(buildDraft('parallel'));
    expect(draft.suggestedPath).toBe('parallel');
  });

  it('accepts Bypass-Lily vocab "Simple" and normalizes to "sequential"', () => {
    const draft = parsePlannerEditableDraft(buildDraft('Simple'));
    expect(draft.suggestedPath).toBe('sequential');
  });

  it('accepts Bypass-Lily vocab "Complex" and normalizes to "parallel"', () => {
    const draft = parsePlannerEditableDraft(buildDraft('Complex'));
    expect(draft.suggestedPath).toBe('parallel');
  });

  it('defaults unrecognized vocab to "sequential" without throwing', () => {
    const draft = parsePlannerEditableDraft(buildDraft('medium'));
    expect(draft.suggestedPath).toBe('sequential');
  });

  it('defaults empty Recommended Execution value to "sequential" without throwing', () => {
    const draft = parsePlannerEditableDraft(buildDraft(''));
    expect(draft.suggestedPath).toBe('sequential');
  });

  it('falls back to the leading word when Lily appends parenthetical or em-dash detail', () => {
    expect(parsePlannerEditableDraft(buildDraft('Sequential (one slice)')).suggestedPath).toBe('sequential');
    expect(parsePlannerEditableDraft(buildDraft('Complex — multi-slice')).suggestedPath).toBe('parallel');
  });

  it('preserves editable requirement section bodies before canonicalization', () => {
    const draft = parsePlannerEditableDraft(buildDraft('Simple'));
    expect(draft.criticalRequirements).toBe('- Preserve exact behavior.');
    expect(draft.compatibilityRequirements).toBe('- Existing callers keep working.');
    expect(draft.requiredValidation).toBe('Run the focused tests.');
  });

  it('defaults omitted requirement sections to exact None', () => {
    const draft = parsePlannerEditableDraft([
      '## Request Summary',
      'Operator wants the thing done.',
      '',
      '## Desired Outcome',
      'The thing is done.',
      '',
      '## Constraints',
      'None',
      '',
      '## Acceptance Signals',
      '- The thing is verifiably done.',
      '',
    ].join('\n'));

    expect(draft.criticalRequirements).toBe('None');
    expect(draft.compatibilityRequirements).toBe('None');
    expect(draft.requiredValidation).toBe('None');
  });

  it('canonicalizes bullets, legacy prefixes, and prose requirement paragraphs', () => {
    expect(canonicalizeRequirementSection('- CR-009: Preserve details.', 'CR')).toBe('- CR-001: Preserve details.');
    expect(canonicalizeRequirementSection('First paragraph.\n\nSecond paragraph.', 'VAL')).toBe([
      '- VAL-001: First paragraph.',
      '- VAL-002: Second paragraph.',
    ].join('\n'));
  });

  it('canonicalizes mixed prose and bullets without dropping text', () => {
    expect(canonicalizeRequirementSection([
      'Preserve the operator preface.',
      '',
      '- Keep the first explicit bullet.',
      '  Include its continuation detail.',
      '',
      'Preserve trailing prose too.',
    ].join('\n'), 'COMP')).toBe([
      '- COMP-001: Preserve the operator preface.',
      '- COMP-002: Keep the first explicit bullet. Include its continuation detail.',
      '- COMP-003: Preserve trailing prose too.',
    ].join('\n'));
  });
});
