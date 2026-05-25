import { describe, expect, it } from 'vitest';
import {
  deriveGuardrailObservationSummary,
  parseGuardrailStatus,
} from './guardrails';

describe('guardrail observation semantics', () => {
  it('does not classify parseable failed platform receipts as malformed', () => {
    expect(parseGuardrailStatus('failed')).toBe('denied');
    expect(parseGuardrailStatus('artifact-incomplete')).toBe('denied');
    expect(parseGuardrailStatus('next-role-blocked')).toBe('denied');
    expect(parseGuardrailStatus('workflow-policy-blocked')).toBe('denied');
    expect(parseGuardrailStatus('policy-blocked')).toBe('denied');
    expect(parseGuardrailStatus('allowed')).toBe('allowed');
    expect(parseGuardrailStatus('passed')).toBe('allowed');
    expect(parseGuardrailStatus('denied')).toBe('denied');
  });

  it('keeps malformed copy for parse errors and invalid receipt statuses only', () => {
    expect(parseGuardrailStatus('unknown')).toBe('malformed');
    expect(deriveGuardrailObservationSummary({
      status: 'malformed',
      parseError: 'bad json',
      launchSeam: null,
      violations: [],
    })).toBe('Malformed guardrail receipt: bad json');
    expect(deriveGuardrailObservationSummary({
      status: 'malformed',
      parseError: null,
      launchSeam: null,
      violations: [],
    })).toBe('Guardrail receipt is malformed.');
  });

  it('renders failed artifact and policy receipts as actionable outcomes', () => {
    expect(deriveGuardrailObservationSummary({
      status: 'denied',
      parseError: null,
      launchSeam: null,
      terminationReason: 'artifact-incomplete',
      violations: [],
    })).toBe('Guardrail receipt reported incomplete artifacts.');
    expect(deriveGuardrailObservationSummary({
      status: 'denied',
      parseError: null,
      launchSeam: null,
      terminationReason: 'next-role-blocked',
      violations: [],
    })).toBe('Guardrail receipt reported workflow policy block.');
  });
});
