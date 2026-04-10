import type { RunRoleAgentOptions } from './types.js';
import { isDaltonFamilyAgent } from './daltonLaunchPrep.js';

// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

export function formatOutputSection(label: string, content: string): string {
  return `--- ${label} ---\n${content || '<no output>'}`;
}

export function agentErrorWithTails(
  message: string,
  runSummary: { stdoutTail: string; stderrTail: string },
): Error {
  return new Error(
    [
      message,
      formatOutputSection('stdout tail', runSummary.stdoutTail),
      formatOutputSection('stderr tail', runSummary.stderrTail),
    ].join('\n'),
  );
}

export function extractPolicyFailureDetails(
  policyResult: { stdout: string; stderr: string },
): string {
  const stderr = policyResult.stderr.trim();
  if (stderr) {
    return stderr;
  }

  const stdout = policyResult.stdout.trim();
  if (!stdout) {
    return '';
  }

  try {
    const parsed = JSON.parse(stdout) as {
      violations?: Array<{ message?: string; rule_id?: string }>;
      next_steps?: string[];
    };
    const violationLines = (parsed.violations ?? [])
      .map((violation) => violation.message?.trim() || violation.rule_id?.trim() || '')
      .filter((line) => line.length > 0);
    const nextStepLines = (parsed.next_steps ?? [])
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const combined = [...violationLines, ...nextStepLines];
    if (combined.length > 0) {
      return combined.join(' | ');
    }
  } catch {
    // Fall back to raw stdout when the validator did not emit JSON.
  }

  return stdout;
}

export function hasConcreteArtifactRemediation(prompt: string): boolean {
  return prompt.trim().length > 0;
}

export function incompleteArtifactOwnerLabel(agentId: RunRoleAgentOptions['agentId']): string {
  if (agentId === 'alice') return 'Alice';
  if (isDaltonFamilyAgent(agentId)) return 'Dalton';
  if (agentId === 'ron') return 'Ron';
  return agentId;
}

const RECOVERABLE_DENIED_ACTION_PATTERNS = [
  /permission denied and could not request permission from user/i,
  /could not request permission from user/i,
  /permission to run this tool was denied due the following rules/i,
];

export function isRecoverableDeniedActionExit(
  runSummary: { stdoutTail: string; stderrTail: string },
): boolean {
  const combinedOutput = `${runSummary.stdoutTail}\n${runSummary.stderrTail}`;
  return RECOVERABLE_DENIED_ACTION_PATTERNS.some((pattern) => pattern.test(combinedOutput));
}

export function buildDeniedActionContinuationPrompt(agentId: RunRoleAgentOptions['agentId']): string {
  const owner = incompleteArtifactOwnerLabel(agentId);
  return [
    `Your previous ${owner} run attempted a denied command or permission request and exited early.`,
    '',
    'Do not run shell commands.',
    'Do not request permission.',
    'Do not retry denied tools.',
    'Continue from the current workspace state using only allowed read/search/write tools.',
    'If you want to verify artifact content, inspect the files directly instead of executing commands.',
    'Finish only the remaining workflow artifacts for your role, then stop.',
  ].join('\n');
}
