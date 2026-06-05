import { describe, expect, it } from 'vitest';
import {
  buildGuardrailSummary,
  deriveGuardrailObservationSummary,
  parseGuardrailStatus,
} from './guardrails';
import type { GuardrailObservation } from '../../src/shared/desktopContract';

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

function makeObservation(overrides: Partial<GuardrailObservation> = {}): GuardrailObservation {
  return {
    receiptPath: '.platform-state/runtime/tasks/TASK-A/guardrails/alice.json',
    sessionId: 'role:alice',
    agentId: 'alice',
    agentLabel: 'Alice (Product Manager)',
    instanceId: null,
    status: 'allowed',
    severity: 'info',
    summary: 'Allowed launch.',
    validatorMode: null,
    launchSeam: null,
    expectedAgentId: null,
    requiredModel: null,
    activeModel: null,
    violationCount: 0,
    violations: [],
    ...overrides,
  };
}

describe('per-task guardrail summary scoping', () => {
  it('guardrail summary for task A does not reflect task B receipts', () => {
    const taskAObservations: GuardrailObservation[] = [
      makeObservation({ receiptPath: 'tasks/TASK-A/guardrails/alice.json', status: 'denied', severity: 'error' }),
    ];
    const taskBObservations: GuardrailObservation[] = [
      makeObservation({ receiptPath: 'tasks/TASK-B/guardrails/dalton.json', status: 'allowed', severity: 'info' }),
    ];

    const summaryA = buildGuardrailSummary(taskAObservations);
    const summaryB = buildGuardrailSummary(taskBObservations);

    // Task A has denied — must be critical
    expect(summaryA.status).toBe('critical');
    expect(summaryA.deniedCount).toBe(1);
    expect(summaryA.allowedCount).toBe(0);

    // Task B is healthy — task A's denied receipt must not bleed in
    expect(summaryB.status).toBe('healthy');
    expect(summaryB.deniedCount).toBe(0);
    expect(summaryB.allowedCount).toBe(1);
  });

  it('returns idle summary when task has no guardrail observations', () => {
    const summary = buildGuardrailSummary([]);
    expect(summary.status).toBe('idle');
    expect(summary.observedReceiptCount).toBe(0);
  });
});
