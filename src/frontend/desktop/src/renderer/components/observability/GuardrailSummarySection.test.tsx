import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GuardrailObservation, GuardrailSummary } from '../../../shared/desktopContract';
import GuardrailSummarySection from './GuardrailSummarySection';

afterEach(() => {
  cleanup();
});

function makeSummary(overrides: Partial<GuardrailSummary> = {}): GuardrailSummary {
  return {
    status: 'healthy',
    summary: 'All agents within bounds',
    observedReceiptCount: 3,
    allowedCount: 3,
    deniedCount: 0,
    internalBypassCount: 0,
    malformedCount: 0,
    violationCount: 0,
    ...overrides,
  };
}

function makeObservation(overrides: Partial<GuardrailObservation> = {}): GuardrailObservation {
  return {
    receiptPath: '/receipts/r1.json',
    sessionId: 'sess-1',
    agentId: 'software-engineer',
    agentLabel: 'Dalton (Software Engineer)',
    instanceId: null,
    status: 'allowed',
    severity: 'info',
    summary: 'All checks passed',
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

describe('GuardrailSummarySection', () => {
  it('shows default idle state when no summary provided', () => {
    render(<GuardrailSummarySection guardrails={[]} />);
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
    expect(screen.getByText('No checks have run yet. They will appear once agents start working.')).toBeInTheDocument();
  });

  it('shows All clear pmdge for healthy status', () => {
    render(<GuardrailSummarySection guardrailSummary={makeSummary()} guardrails={[]} />);
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('shows Needs review pmdge for attention status', () => {
    render(
      <GuardrailSummarySection
        guardrailSummary={makeSummary({ status: 'attention' })}
        guardrails={[]}
      />,
    );
    expect(screen.getByText('Needs review')).toBeInTheDocument();
  });

  it('shows Issues found pmdge for critical status', () => {
    render(
      <GuardrailSummarySection
        guardrailSummary={makeSummary({ status: 'critical' })}
        guardrails={[]}
      />,
    );
    expect(screen.getByText('Issues found')).toBeInTheDocument();
  });

  it('renders stat row with counts', () => {
    render(
      <GuardrailSummarySection
        guardrailSummary={makeSummary({ observedReceiptCount: 5, allowedCount: 4, deniedCount: 1 })}
        guardrails={[]}
      />,
    );
    expect(screen.getByText('5 checked')).toBeInTheDocument();
    expect(screen.getByText('4 passed')).toBeInTheDocument();
    expect(screen.getByText('1 denied')).toBeInTheDocument();
  });

  it('renders guardrail observations', () => {
    render(
      <GuardrailSummarySection
        guardrailSummary={makeSummary()}
        guardrails={[makeObservation()]}
      />,
    );
    expect(screen.getByText('Dalton (Software Engineer)')).toBeInTheDocument();
    expect(screen.getByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByText('allowed')).toBeInTheDocument();
  });

  it('humanizes hyphenated status', () => {
    render(
      <GuardrailSummarySection
        guardrailSummary={makeSummary()}
        guardrails={[makeObservation({ status: 'internal-bypass' })]}
      />,
    );
    expect(screen.getByText('internal bypass')).toBeInTheDocument();
  });
});
