/**
 * Transition legality and artifact agent-ID rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_transition.py
 */

import path from 'node:path';
import { readTextFile, resolvePaths, safeJsonParse } from '../../core/index.js';
import { ISSUES_MD_RELATIVE_PATH } from '../models.js';
import {
  issuesHaveBlockingFindings,
  issuesSectionsHaveFindings,
} from '../matching.js';
import type { NamedAgentTeam } from '../types.js';
import { toHandoffKey } from '../validator.js';
import type { PolicyValidator } from '../validator.js';

function agentWorkflowOrder(namedAgentTeam: NamedAgentTeam, agentId: string): number | null {
  const agent = namedAgentTeam[agentId];
  if (!agent) {
    return null;
  }
  return agent.workflowOrder;
}

async function checkWorkflowOrderRegression(validator: PolicyValidator): Promise<void> {
  if (!validator.requestedAgentId) {
    return;
  }

  const { expectedAgentId } = await validator.inferExpectedRuntimeAgent();
  if (!expectedAgentId) {
    return;
  }

  const requestedOrder = agentWorkflowOrder(validator.namedAgentTeam, validator.requestedAgentId);
  const expectedOrder = agentWorkflowOrder(validator.namedAgentTeam, expectedAgentId);
  if (requestedOrder === null || expectedOrder === null) {
    return;
  }

  // Forward transitions and same-role re-invocations are always allowed.
  if (requestedOrder >= expectedOrder) {
    return;
  }

  // Documented remediation loops: Dalton may be re-invoked from QA for remediation.
  if (validator.requestedAgentId === 'software-engineer') {
    const issues = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);
    const issuesActive =
      issues.exists &&
      issues.hasSubstantiveContent &&
      issuesHaveBlockingFindings(issues.sections);
    if (issuesActive) {
      return;
    }
  }

  validator.addViolation({
    rule_id: 'runtime.workflow-order-regression',
    artifact: 'handoffs/',
    severity: 'error',
    message: `Backward workflow transition: requested '${validator.requestedAgentId}' (order ${requestedOrder}) but current workflow state expects '${expectedAgentId}' (order ${expectedOrder}). Backward transitions are only allowed for documented remediation loops.`,
    remediation: `Invoke '${expectedAgentId}' to continue the workflow, or record a remediation finding in issues.md if a loop is required.`,
  });
}

async function checkRemediationLoopExecutionRequired(
  validator: PolicyValidator,
): Promise<void> {
  if (!validator.requestedAgentId || validator.requestedAgentId !== 'qa') {
    return;
  }

  const issues = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);
  if (
    !(
      issues.exists &&
      issues.hasSubstantiveContent &&
      issuesHaveBlockingFindings(issues.sections)
    )
  ) {
    return;
  }

  // Check for evidence that software-engineer ran (guardrail receipt).
  const taskId = validator.taskId;
  if (!taskId) {
    throw new Error('task context required; activate a pending item before validation');
  }
  const taskRuntime = resolvePaths({ repoRoot: validator.rootDir, taskId }).taskRuntime;
  const engineerReceiptPath = path.join(taskRuntime, 'guardrails', 'software-engineer.json');
  let engineerRan = false;

  const receiptText = await readTextFile(engineerReceiptPath);
  if (receiptText !== undefined) {
    try {
      const engineerData = safeJsonParse<Record<string, unknown>>(receiptText, engineerReceiptPath);
      const status = engineerData?.status ?? '';
      if (status === 'passed' || status === 'internal-bypass') {
        engineerRan = true;
      }
    } catch {
      // ignore parse errors
    }
  }

  if (!engineerRan) {
    // Also check role-sessions.
    const sessionPath = path.join(taskRuntime, 'role-sessions', 'software-engineer.json');
    const sessionText = await readTextFile(sessionPath);
    if (sessionText !== undefined) {
      try {
        const session = safeJsonParse<Record<string, unknown>>(sessionText, sessionPath);
        const terminal = session?.terminal;
        if (terminal && typeof terminal === 'object' && (terminal as Record<string, unknown>).status) {
          engineerRan = true;
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  if (!engineerRan) {
    validator.addViolation({
      rule_id: 'runtime.remediation-loop-execution-required',
      artifact: ISSUES_MD_RELATIVE_PATH,
      severity: 'error',
      message:
        'QA re-review requested but no implementation execution evidence was found. The mandatory remediation path is QA → Software Engineer → QA; Dalton must perform remediation before QA re-review.',
      remediation: 'Run Software Engineer (Dalton) to fix and revalidate before returning to QA.',
    });
  }
}

function checkChildTaskLineageEarly(validator: PolicyValidator, professional: {
  exists: boolean;
  hasSubstantiveContent: boolean;
  taskLineage: Record<string, string>;
  relativePath: string;
}): void {
  if (!professional.exists || !professional.hasSubstantiveContent) {
    return;
  }
  const taskKind = (professional.taskLineage['Task Kind'] ?? '').trim();
  if (taskKind !== 'child-task') {
    return;
  }
  const required = [
    'Parent Task ID',
    'Root Task ID',
    'Parent QMD Record ID',
    'Parent QMD Scope',
    'Follow-Up Reason',
  ];
  const missing = required.filter((f) => !(professional.taskLineage[f] ?? '').trim());
  if (missing.length > 0) {
    validator.addViolation({
      rule_id: 'runtime.child-task-lineage-incomplete',
      artifact: professional.relativePath,
      severity: 'error',
      message: `Task Kind is 'child-task' but required lineage fields are missing in professional-task.md: ${missing.join(', ')}.`,
      remediation:
        'Populate all child-task lineage fields (Parent Task ID, Root Task ID, Parent QMD Record ID, Parent QMD Scope, Follow-Up Reason) before launching workflow agents.',
    });
  }
}

export async function evaluateTransitionLegalityRules(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('path.decision-owner-agent-valid');
  validator.recordRule('path.next-role-agent-valid');
  validator.recordRule('remediation.qa-loop-agents-valid');
  validator.recordRule('closeout.owner-agent-valid');
  validator.recordRule('runtime.agent-transition-legal');
  validator.recordRule('runtime.workflow-order-regression');
  validator.recordRule('runtime.remediation-loop-execution-required');
  validator.recordRule('runtime.child-task-lineage-incomplete');

  if (validator.namedAgentRegistryErrors.length > 0 || !validator.hasActiveTask()) {
    return;
  }

  // Bootstrap workspaces contain template placeholders — transition rules not applicable.
  if (validator.mode === 'activation-bootstrap') {
    return;
  }

  const severity = validator.transitionRuleSeverity();
  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);

  if (
    validator.mode !== 'pre-archive' &&
    validator.mode !== 'queue-advance' &&
    issuesArtifact.exists &&
    issuesArtifact.hasSubstantiveContent &&
    issuesSectionsHaveFindings(issuesArtifact.sections)
  ) {
    const expectedQaLoop: Record<string, string> = {
      'Remediation Owner Agent ID': 'software-engineer',
      'Revalidation Agent ID': 'qa',
      'Return-To Agent ID': 'qa',
    };
    for (const [label, expectedAgentId] of Object.entries(expectedQaLoop)) {
      const actualAgentId = validator.readAgentIdSection(issuesArtifact, label);
      if (actualAgentId === expectedAgentId) {
        continue;
      }
      validator.addViolation({
        rule_id: 'remediation.qa-loop-agents-valid',
        artifact: issuesArtifact.relativePath,
        severity,
        message: `QA issue handoffs must encode the legal QA loop; ${label} must be '${expectedAgentId}', found '${actualAgentId || 'blank'}'.`,
        remediation:
          'Set QA issue routing to software-engineer for remediation, qa for revalidation, and qa for return-to review before guarded transitions run.',
      });
    }
  }

  const finalSummary = await validator.getArtifact(toHandoffKey('final-summary.md'));
  if (finalSummary.exists && finalSummary.hasSubstantiveContent) {
    const closeoutOwner = validator.readAgentIdSection(finalSummary, 'Closeout Owner Agent ID');
    if (closeoutOwner !== 'qa') {
      validator.addViolation({
        rule_id: 'closeout.owner-agent-valid',
        artifact: finalSummary.relativePath,
        severity,
        message: `Final-summary closeout must be owned by 'qa', found '${closeoutOwner || 'blank'}'.`,
        remediation:
          'Set Closeout Owner Agent ID to qa before closeout, archival, or queue advancement.',
      });
    }
  }

  if (!validator.requestedAgentId) {
    return;
  }

  const { expectedAgentId: expectedId, expectedSource: sourceLabel } =
    await validator.inferExpectedRuntimeAgent();

  if (expectedId && validator.requestedAgentId !== expectedId) {
    validator.addViolation({
      rule_id: 'runtime.agent-transition-legal',
      artifact: 'handoffs/',
      severity: 'error',
      message: `Requested agent transition is not legal for the current workflow state: expected '${expectedId}' from ${sourceLabel}, found '${validator.requestedAgentId}'.`,
      remediation: `Invoke ${expectedId} for the current workflow state or bypass the runtime check intentionally if the repo artifacts have not been updated yet.`,
    });
  }

  if (validator.mode === 'runtime') {
    await checkWorkflowOrderRegression(validator);
    await checkRemediationLoopExecutionRequired(validator);
    const professional = await validator.getArtifact(toHandoffKey('professional-task.md'));
    checkChildTaskLineageEarly(validator, professional);
  }
}

export async function evaluateArtifactAgentIdRules(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('artifact.issues-remediation-owner-agent-id');
  validator.recordRule('artifact.issues-revalidation-agent-id');
  validator.recordRule('artifact.issues-return-to-agent-id');
  validator.recordRule('artifact.final-summary-closeout-owner-agent-id');

  if (validator.mode !== 'lint' || !validator.hasActiveTask()) {
    return;
  }

  const validAgentIds = Object.keys(validator.namedAgentTeam).sort().join(', ');
  const issuesArtifact = await validator.getArtifact(ISSUES_MD_RELATIVE_PATH);

  if (issuesArtifact.exists && issuesArtifact.hasSubstantiveContent) {
    validator.validateAgentIdSection({
      artifact: issuesArtifact,
      sectionName: 'Remediation Owner Agent ID',
      ruleId: 'artifact.issues-remediation-owner-agent-id',
      missingMessage: 'QA issues handoff should include a non-empty Remediation Owner Agent ID section.',
      invalidMessage: "QA issues handoff declares unknown Remediation Owner Agent ID '{agent_id}'.",
      remediation: `Set Remediation Owner Agent ID to a registry-pmcked agent_id. Valid values: ${validAgentIds}.`,
    });
    validator.validateAgentIdSection({
      artifact: issuesArtifact,
      sectionName: 'Revalidation Agent ID',
      ruleId: 'artifact.issues-revalidation-agent-id',
      missingMessage: 'QA issues handoff should include a non-empty Revalidation Agent ID section.',
      invalidMessage: "QA issues handoff declares unknown Revalidation Agent ID '{agent_id}'.",
      remediation: `Set Revalidation Agent ID to a registry-pmcked agent_id. Valid values: ${validAgentIds}.`,
    });
    validator.validateAgentIdSection({
      artifact: issuesArtifact,
      sectionName: 'Return-To Agent ID',
      ruleId: 'artifact.issues-return-to-agent-id',
      missingMessage: 'QA issues handoff should include a non-empty Return-To Agent ID section.',
      invalidMessage: "QA issues handoff declares unknown Return-To Agent ID '{agent_id}'.",
      remediation: `Set Return-To Agent ID to a registry-pmcked agent_id. Valid values: ${validAgentIds}.`,
    });
  }

  const finalSummary = await validator.getArtifact(toHandoffKey('final-summary.md'));
  if (finalSummary.exists && finalSummary.hasSubstantiveContent) {
    validator.validateAgentIdSection({
      artifact: finalSummary,
      sectionName: 'Closeout Owner Agent ID',
      ruleId: 'artifact.final-summary-closeout-owner-agent-id',
      missingMessage: 'Final summary should include a non-empty Closeout Owner Agent ID section.',
      invalidMessage: "Final summary declares unknown Closeout Owner Agent ID '{agent_id}'.",
      remediation: `Set Closeout Owner Agent ID to a registry-pmcked agent_id. Valid values: ${validAgentIds}.`,
    });
  }
}
