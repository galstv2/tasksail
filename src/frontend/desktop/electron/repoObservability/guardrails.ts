import { join } from 'node:path';

import type {
  AgentTerminalSession,
  GuardrailObservation,
  GuardrailSummary,
  GuardrailViolation,
} from '../../src/shared/desktopContract';
import { escapeRegExp } from '../../../../backend/platform/core/index.js';
import { stringOrNull, type ReadOnlyRepoFs } from '../utils';
import { getAgentLabel, type AgentLabelProfile } from './agentLabels';
import {
  type GuardrailSeverity,
  asJsonObject,
  readDirIfPresent,
  readJsonObjectIfPresent,
  toRepoRelativePath,
} from './shared';

export function severityRank(value: GuardrailSeverity): number {
  switch (value) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

export function parseGuardrailStatus(
  value: unknown,
): GuardrailObservation['status'] {
  switch (value) {
    case 'allowed':
    case 'passed':
    case 'denied':
    case 'internal-bypass':
      return value === 'passed' ? 'allowed' : value;
    case 'failed':
    case 'artifact-incomplete':
    case 'next-role-blocked':
    case 'workflow-policy-blocked':
    case 'policy-blocked':
      return 'denied';
    default:
      return 'malformed';
  }
}

export function parseGuardrailViolations(
  value: unknown,
  receiptPath: string,
): GuardrailViolation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const violation = asJsonObject(item);
    if (!violation) {
      return [];
    }
    const message = stringOrNull(violation.message);
    const ruleId = stringOrNull(violation.rule_id);
    if (!message || !ruleId) {
      return [];
    }
    return [
      {
        receiptPath,
        ruleId,
        severity:
          violation.severity === 'error' ||
          violation.severity === 'warning' ||
          violation.severity === 'info'
            ? violation.severity
            : 'error',
        message,
        remediation: stringOrNull(violation.remediation),
      },
    ];
  });
}

export function deriveGuardrailObservationSummary(args: {
  status: GuardrailObservation['status'];
  parseError: string | null;
  launchSeam: string | null;
  terminationReason?: string | null;
  violations: GuardrailViolation[];
}): string {
  const { status, parseError, launchSeam, terminationReason, violations } = args;
  if (parseError) {
    return `Malformed guardrail receipt: ${parseError}`;
  }
  if (violations.length > 0) {
    return violations[0]?.message ?? 'Guardrail violations were recorded.';
  }
  if (status === 'denied') {
    if (terminationReason === 'artifact-incomplete') {
      return 'Guardrail receipt reported incomplete artifacts.';
    }
    if (
      terminationReason === 'next-role-blocked' ||
      terminationReason === 'workflow-policy-blocked' ||
      terminationReason === 'policy-blocked'
    ) {
      return 'Guardrail receipt reported workflow policy block.';
    }
    return 'Launch denied by repository guardrails.';
  }
  if (status === 'internal-bypass') {
    return launchSeam
      ? `Approved internal bypass attested through ${launchSeam}.`
      : 'Approved internal bypass attested for this runtime.';
  }
  if (status === 'malformed') {
    return 'Guardrail receipt is malformed.';
  }
  return 'Guardrail receipt recorded an allowed launch.';
}

export function deriveGuardrailObservationSeverity(args: {
  status: GuardrailObservation['status'];
  parseError: string | null;
  violations: GuardrailViolation[];
}): GuardrailSeverity {
  const { status, parseError, violations } = args;
  if (
    parseError ||
    status === 'denied' ||
    status === 'malformed' ||
    violations.some((violation) => violation.severity === 'error')
  ) {
    return 'error';
  }
  if (
    status === 'internal-bypass' ||
    violations.some((violation) => violation.severity === 'warning')
  ) {
    return 'warning';
  }
  return 'info';
}

export function inferGuardrailIdentity(receiptFile: string, rosterAgentIds: readonly string[]): {
  agentId: string;
  instanceId: string | null;
  sessionId: string | null;
} {
  const stem = receiptFile.replace(/\.json$/u, '');
  const sortedAgentIds = [...rosterAgentIds].sort((left, right) => right.length - left.length);

  for (const agentId of sortedAgentIds) {
    const escapedAgentId = escapeRegExp(agentId);
    if (new RegExp(`^${escapedAgentId}$`, 'u').test(stem)) {
      return { agentId, instanceId: null, sessionId: `role:${agentId}` };
    }
    const instanceMatch = new RegExp(`^${escapedAgentId}-(.+)$`, 'u').exec(stem);
    if (instanceMatch?.[1]) {
      return { agentId, instanceId: instanceMatch[1], sessionId: `parallel:${instanceMatch[1]}` };
    }
  }

  return { agentId: stem, instanceId: null, sessionId: `role:${stem}` };
}

export async function readGuardrailObservations(
  fsAdapter: ReadOnlyRepoFs,
  guardrailReceiptsDir: string,
  rosterAgentIds: readonly string[],
  agentLabelLookup: Map<string, AgentLabelProfile>,
): Promise<GuardrailObservation[]> {
  const receiptFiles = (await readDirIfPresent(guardrailReceiptsDir, fsAdapter))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const observations: GuardrailObservation[] = [];

  for (const receiptFile of receiptFiles) {
    const receiptPath = join(guardrailReceiptsDir, receiptFile);
    const relativePath = toRepoRelativePath(receiptPath);
    const { payload, parseError } = await readJsonObjectIfPresent(
      receiptPath,
      fsAdapter,
    );
    const inferredIdentity = inferGuardrailIdentity(receiptFile, rosterAgentIds);
    const status = parseGuardrailStatus(payload?.status);
    const agentId =
      stringOrNull(payload?.resolved_agent_id) ??
      stringOrNull(payload?.requested_agent_id) ??
      inferredIdentity.agentId;
    const instanceId =
      stringOrNull(payload?.instance_id) ?? inferredIdentity.instanceId;
    const violations = parseGuardrailViolations(
      payload?.violations,
      relativePath,
    );
    const launchSeam = stringOrNull(payload?.launch_seam);
    const terminationReason = stringOrNull(payload?.termination_reason);

    observations.push({
      receiptPath: relativePath,
      sessionId: instanceId
        ? `parallel:${instanceId}`
        : inferredIdentity.sessionId,
      agentId,
      agentLabel: getAgentLabel(agentId, instanceId, agentLabelLookup),
      instanceId,
      status: parseError ? 'malformed' : status,
      severity: deriveGuardrailObservationSeverity({
        status,
        parseError,
        violations,
      }),
      summary: deriveGuardrailObservationSummary({
        status,
        parseError,
        launchSeam,
        terminationReason,
        violations,
      }),
      validatorMode: stringOrNull(payload?.validator_mode),
      launchSeam,
      expectedAgentId: stringOrNull(payload?.expected_agent_id),
      requiredModel: stringOrNull(payload?.required_model),
      activeModel: stringOrNull(payload?.active_model),
      violationCount: violations.length,
      violations,
    });
  }

  return observations.sort((left, right) => {
    return (
      severityRank(right.severity) - severityRank(left.severity) ||
      left.receiptPath.localeCompare(right.receiptPath)
    );
  });
}

export function buildGuardrailSummary(
  observations: GuardrailObservation[],
): GuardrailSummary {
  const observedReceiptCount = observations.length;
  const allowedCount = observations.filter(
    (observation) => observation.status === 'allowed',
  ).length;
  const deniedCount = observations.filter(
    (observation) => observation.status === 'denied',
  ).length;
  const internalBypassCount = observations.filter(
    (observation) => observation.status === 'internal-bypass',
  ).length;
  const malformedCount = observations.filter(
    (observation) => observation.status === 'malformed',
  ).length;
  const violationCount = observations.reduce(
    (count, observation) => count + observation.violationCount,
    0,
  );

  if (observedReceiptCount === 0) {
    return {
      status: 'idle',
      summary: 'No guardrail receipts observed yet.',
      observedReceiptCount,
      allowedCount,
      deniedCount,
      internalBypassCount,
      malformedCount,
      violationCount,
    };
  }

  if (deniedCount > 0 || malformedCount > 0) {
    return {
      status: 'critical',
      summary:
        `${deniedCount} denied and ${malformedCount} malformed ` +
        'guardrail receipt(s) need operator review.',
      observedReceiptCount,
      allowedCount,
      deniedCount,
      internalBypassCount,
      malformedCount,
      violationCount,
    };
  }

  if (internalBypassCount > 0 || violationCount > 0) {
    return {
      status: 'attention',
      summary:
        `${internalBypassCount} internal-bypass attestation(s) and ` +
        `${violationCount} guardrail violation(s) were observed.`,
      observedReceiptCount,
      allowedCount,
      deniedCount,
      internalBypassCount,
      malformedCount,
      violationCount,
    };
  }

  return {
    status: 'healthy',
    summary:
      `${allowedCount} guardrail receipt(s) recorded compliant launches.`,
    observedReceiptCount,
    allowedCount,
    deniedCount,
    internalBypassCount,
    malformedCount,
    violationCount,
  };
}

export function mergeGuardrailStateIntoSessions(
  sessions: AgentTerminalSession[],
  observations: GuardrailObservation[],
): AgentTerminalSession[] {
  // Guardrail observations use agentId-only sessionIds (e.g. "role:dalton")
  // while sessions now include timestamps (e.g. "role:dalton:2026-04-03T...").
  // Index observations by their sessionId and match sessions by agentId prefix.
  const observationsBySession = new Map<string, GuardrailObservation[]>();
  for (const observation of observations) {
    if (!observation.sessionId) {
      continue;
    }
    observationsBySession.set(observation.sessionId, [
      ...(observationsBySession.get(observation.sessionId) ?? []),
      observation,
    ]);
  }

  // Find the most recent session per agentId so guardrails attach to the
  // current launch, not historical ones.
  const latestByAgent = new Map<string, { sessionId: string; lastUpdatedAt: string }>();
  for (const session of sessions) {
    const existing = latestByAgent.get(session.agentId);
    if (!existing || (session.lastUpdatedAt ?? '') > existing.lastUpdatedAt) {
      latestByAgent.set(session.agentId, { sessionId: session.sessionId, lastUpdatedAt: session.lastUpdatedAt ?? '' });
    }
  }

  return sessions.map((session) => {
    // Try exact match first, then fall back to agentId-only key for the latest session.
    let matches = observationsBySession.get(session.sessionId) ?? [];
    if (matches.length === 0) {
      const agentKey = `role:${session.agentId}`;
      if (latestByAgent.get(session.agentId)?.sessionId === session.sessionId) {
        matches = observationsBySession.get(agentKey) ?? [];
      }
    }
    if (matches.length === 0) {
      return session;
    }

    const selected = matches.reduce((current, candidate) => {
      return severityRank(candidate.severity) > severityRank(current.severity)
        ? candidate
        : current;
    });
    let severity = session.severity;
    if (selected.severity === 'error') {
      severity = 'error';
    } else if (
      selected.severity === 'warning' &&
      severity !== 'error'
    ) {
      severity = 'warning';
    }

    return {
      ...session,
      severity,
      guardrailStatus: selected.status,
      guardrailSeverity: selected.severity,
      guardrailReason: selected.summary,
      guardrailReceiptPath: selected.receiptPath,
      guardrailViolationCount: selected.violationCount,
    };
  });
}
