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

  it('rejects unknown vocab with the Simple/Complex error message', () => {
    expect(() => parsePlannerEditableDraft(buildDraft('medium'))).toThrowError(
      /Simple or Complex before finalizing/,
    );
  });

  it('rejects empty Recommended Execution value', () => {
    expect(() => parsePlannerEditableDraft(buildDraft(''))).toThrowError(
      /Simple or Complex before finalizing/,
    );
  });
});
