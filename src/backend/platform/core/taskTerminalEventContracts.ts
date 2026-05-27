export type TaskAgentLaunchPhase =
  | 'initial'
  | 'cleanup'
  | 'remediation'
  | 'revalidation'
  | 'retrospective'
  | 'verification'
  | 'confinement-retry'
  | 'closeout-remediation';

export type TaskAgentLaunchOutcome =
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'timeout'
  | 'artifact-incomplete'
  | 'policy-blocked';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  lily: 'Lily',
  alice: 'Alice - PM',
  dalton: 'Dalton - SWE',
  'dalton-verify': 'Dalton - SWE',
  ron: 'Ron - QA',
};

export function normalizeAgentLaunchPhase(input: {
  agentId: string;
  launchPhase?: string | null;
  promptOverride?: boolean;
}): TaskAgentLaunchPhase {
  const phase = (input.launchPhase ?? '').trim().toLowerCase();
  if (!phase) return 'initial';
  if (phase === 'artifact cleanup') return 'cleanup';
  if (phase === 'policy remediation' || phase === 'remediation') return 'remediation';
  if (phase === 'revalidation') return 'revalidation';
  if (phase === 'retrospective') return 'retrospective';
  if (phase === 'verification') return 'verification';
  if (phase === 'confinement retry') return 'confinement-retry';
  if (phase === 'closeout remediation') return 'closeout-remediation';
  return 'initial';
}

export function formatTaskAgentDisplayName(input: {
  agentId: string;
  phase: TaskAgentLaunchPhase;
}): string {
  const base = AGENT_DISPLAY_NAMES[input.agentId] ?? input.agentId;
  if (input.phase === 'initial') return base;
  if (input.phase === 'verification' && input.agentId === 'dalton-verify') return `${base} (verify)`;
  if (input.phase === 'confinement-retry') return `${base} (confinement retry)`;
  if (input.phase === 'closeout-remediation') return `${base} (closeout remediation)`;
  return `${base} (${input.phase})`;
}

export function normalizeTaskAgentLaunchOutcome(input: {
  processStatus?: 'success' | 'failure' | 'killed' | 'timeout' | null;
  exitCode?: number | null;
  roleSessionTerminalStatus?: 'completed' | 'failed' | 'running' | 'pending' | 'unknown' | null;
  roleSessionExitCode?: number | null;
  guardrailStatus?: string | null;
  terminationReason?: string | null;
  workflowPolicyStatus?: string | null;
}): TaskAgentLaunchOutcome {
  if (input.roleSessionTerminalStatus === 'completed' && input.roleSessionExitCode === 0) {
    return 'completed';
  }
  const guardrailStatus = (input.guardrailStatus ?? '').trim().toLowerCase();
  const terminationReason = (input.terminationReason ?? input.workflowPolicyStatus ?? '').trim().toLowerCase();
  if (guardrailStatus === 'passed' || guardrailStatus === 'allowed') {
    return 'completed';
  }
  if (guardrailStatus === 'failed' && terminationReason === 'artifact-incomplete') {
    return 'artifact-incomplete';
  }
  if (
    guardrailStatus === 'failed'
    && (terminationReason === 'next-role-blocked'
      || terminationReason === 'workflow-policy-blocked'
      || terminationReason === 'policy-blocked')
  ) {
    return 'policy-blocked';
  }
  if (input.processStatus === 'success' || input.exitCode === 0) return 'completed';
  if (input.processStatus === 'killed') return 'killed';
  if (input.processStatus === 'timeout') return 'timeout';
  if (input.roleSessionTerminalStatus === 'running') return 'running';
  return input.processStatus === undefined && input.exitCode === undefined ? 'running' : 'failed';
}

export function formatTaskAgentLaunchMessage(input: {
  displayName: string;
  outcome: TaskAgentLaunchOutcome;
}): string {
  switch (input.outcome) {
    case 'running':
      return `Started ${input.displayName}.`;
    case 'completed':
      return `${input.displayName} completed.`;
    case 'artifact-incomplete':
      return `${input.displayName} artifacts incomplete.`;
    case 'policy-blocked':
      return `${input.displayName} blocked by workflow policy.`;
    case 'killed':
      return `${input.displayName} stopped.`;
    case 'timeout':
      return `${input.displayName} timed out.`;
    case 'failed':
      return `${input.displayName} failed.`;
  }
}
