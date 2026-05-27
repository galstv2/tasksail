import { describe, expect, it } from 'vitest';
import { formatTaskAgentDisplayName } from '../taskTerminalEventContracts.js';

describe('formatTaskAgentDisplayName', () => {
  it('renders role-aware display names for known task agents', () => {
    expect(formatTaskAgentDisplayName({ agentId: 'alice', phase: 'initial' })).toBe('Alice - PM');
    expect(formatTaskAgentDisplayName({ agentId: 'dalton', phase: 'initial' })).toBe('Dalton - SWE');
    expect(formatTaskAgentDisplayName({ agentId: 'dalton-verify', phase: 'verification' })).toBe('Dalton - SWE (verify)');
    expect(formatTaskAgentDisplayName({ agentId: 'ron', phase: 'initial' })).toBe('Ron - QA');
  });

  it('preserves phase suffixes after known role labels', () => {
    expect(formatTaskAgentDisplayName({ agentId: 'alice', phase: 'cleanup' })).toBe('Alice - PM (cleanup)');
    expect(formatTaskAgentDisplayName({ agentId: 'dalton', phase: 'remediation' })).toBe('Dalton - SWE (remediation)');
    expect(formatTaskAgentDisplayName({ agentId: 'ron', phase: 'revalidation' })).toBe('Ron - QA (revalidation)');
    expect(formatTaskAgentDisplayName({ agentId: 'ron', phase: 'cleanup' })).toBe('Ron - QA (cleanup)');
    expect(formatTaskAgentDisplayName({ agentId: 'ron', phase: 'closeout-remediation' })).toBe('Ron - QA (closeout remediation)');
  });

  it('preserves unknown-agent fallback behavior and suffix formatting', () => {
    expect(formatTaskAgentDisplayName({ agentId: 'unknown-agent', phase: 'initial' })).toBe('unknown-agent');
    expect(formatTaskAgentDisplayName({ agentId: 'unknown-agent', phase: 'cleanup' })).toBe('unknown-agent (cleanup)');
    expect(formatTaskAgentDisplayName({ agentId: 'unknown-agent', phase: 'closeout-remediation' })).toBe('unknown-agent (closeout remediation)');
  });
});
