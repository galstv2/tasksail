import { describe, expect, it } from 'vitest';
import { parsePlannerEditableDraft } from '../main.markdown';

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
});
