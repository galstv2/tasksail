import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';

import {
  type AgentTerminalSession,
  type ArtifactReference,
  type GuardrailObservation,
  type GuardrailSummary,
  type GuardrailViolation,
  type LifecycleState,
  type ObservabilitySnapshotResponse,
  type OperatorStatus,
  type PendingQueueItem,
  type QueueStatusResponse,
  type TaskRecoveryState,
  type TaskHealthRollup,
  type TaskLifecycleFeed,
  type WorkflowLifecycleEntry,
} from '../src/shared/desktopContract';
import { namedWorkflowAgentRoster, type NamedWorkflowAgentProfile } from '../src/shared/agentRoster';
import { REPO_ROOT } from './paths';
import { readTaskRecoveryState } from './main.recoveryState';
import { pathExists, stringOrNull, repoFs, type ReadOnlyRepoFs } from './utils';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const PENDING_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'pendingitems');
const HANDOFFS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'handoffs');
const IMPLEMENTATION_STEPS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'ImplementationSteps');
const ACTIVE_ITEM_PATH = join(PENDING_DIR, '.active-item');
const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');
const ROLE_RUNTIME_SESSIONS_DIR = join(REPO_ROOT, '.platform-state/runtime/role-sessions');
const GUARDRAIL_RECEIPTS_DIR = join(REPO_ROOT, '.platform-state/runtime/guardrails');
const PARALLEL_OK_PATH = join(HANDOFFS_DIR, 'parallel-ok.md');
const SUSPECTED_STUCK_AFTER_MS = 20 * 60 * 1000;
const ORPHANED_GRACE_MS = 2 * 60 * 1000;

type GuardrailSeverity = 'info' | 'warning' | 'error';

type JsonObject = Record<string, unknown>;

function toRepoRelativePath(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
}

async function readMarkdownFileIfPresent(
  path: string,
  fsAdapter: ReadOnlyRepoFs,
): Promise<string | null> {
  if (!(await pathExists(path, fsAdapter))) {
    return null;
  }

  return fsAdapter.readFile(path, 'utf-8');
}

async function countMarkdownFiles(path: string, fsAdapter: ReadOnlyRepoFs): Promise<number> {
  if (!(await pathExists(path, fsAdapter))) {
    return 0;
  }

  const entries = await fsAdapter.readdir(path);
  return entries.filter((entry) => entry.endsWith('.md') && entry !== '.gitkeep').length;
}

function extractMetadataValue(content: string | null, label: string): string | null {
  if (!content) {
    return null;
  }

  const match = content.match(new RegExp(`^- ${label}:[ \t]*([^\r\n]*)$`, 'm'));
  return match?.[1]?.trim() || null;
}

function extractHeading(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function normalizeActiveItemName(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('#') || !trimmed.endsWith('.md')) {
    return null;
  }
  return trimmed;
}

async function readPendingQueueItems(
  fsAdapter: ReadOnlyRepoFs,
  activeItem: string | null,
): Promise<PendingQueueItem[]> {
  if (!(await pathExists(PENDING_DIR, fsAdapter))) {
    return [];
  }

  const entries = (await fsAdapter.readdir(PENDING_DIR))
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
    .sort();

  const items: PendingQueueItem[] = [];
  for (const queueName of entries) {
    const content = await readMarkdownFileIfPresent(join(PENDING_DIR, queueName), fsAdapter);
    const state: PendingQueueItem['state'] =
      queueName === activeItem ? 'active' : 'pending';
    items.push({
      queueName,
      taskId: extractMetadataValue(content, 'Task ID'),
      title: extractMetadataValue(content, 'Task Title') || extractHeading(content),
      state,
      canDelete: state === 'pending',
    });
  }

  return items;
}

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readJsonObjectIfPresent(
  path: string,
  fsAdapter: ReadOnlyRepoFs,
): Promise<{ payload: JsonObject | null; parseError: string | null }> {
  if (!(await pathExists(path, fsAdapter))) {
    return { payload: null, parseError: null };
  }

  try {
    const raw = await fsAdapter.readFile(path, 'utf-8');
    const payload = JSON.parse(raw) as unknown;
    const jsonObject = asJsonObject(payload);
    if (!jsonObject) {
      return { payload: null, parseError: 'JSON payload must be an object.' };
    }
    return { payload: jsonObject, parseError: null };
  } catch (error) {
    return {
      payload: null,
      parseError: error instanceof Error ? error.message : 'Unable to parse JSON payload.',
    };
  }
}

// Pre-computed lookup: maps both registry keys ("software-engineer") and
// human_name aliases ("dalton") to roster profiles for O(1) resolution.
const agentLabelLookup = new Map<string, NamedWorkflowAgentProfile>(
  Object.entries(namedWorkflowAgentRoster).flatMap(([key, profile]) => [
    [key, profile],
    [profile.humanName.toLowerCase(), profile],
  ]),
);

function getAgentLabel(agentId: string, instanceId: string | null): string {
  const rosterEntry = agentLabelLookup.get(agentId) ?? agentLabelLookup.get(agentId.toLowerCase());

  if (rosterEntry) {
    return instanceId ? `${rosterEntry.humanName} · ${instanceId}` : rosterEntry.displayName;
  }

  return instanceId ? `${agentId} · ${instanceId}` : agentId;
}

function stringArrayOrEmpty(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(-4);
}

function splitOutputLines(...chunks: Array<string | null | undefined>): string[] {
  return chunks
    .flatMap((chunk) => (chunk ?? '').split(/\r?\n/g))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-4);
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function probePidLiveness(
  pid: number | null,
  launchStartedAt?: string | null,
  platform: NodeJS.Platform = process.platform,
): AgentTerminalSession['liveness'] {
  if (pid === null || pid <= 0) {
    return 'unknown';
  }

  try {
    process.kill(pid, 0);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    ) {
      return 'not-found';
    }
    return 'unknown';
  }

  // PID reuse guard: verify the process started before/around our launch time.
  // If the process started significantly after the receipt was written, the
  // PID was recycled by the OS for a different process.
  if (launchStartedAt) {
    if (platform === 'win32') {
      // Best-effort on Windows: keep the cheap existence probe above, but skip
      // the POSIX-only start-time check instead of shelling out to `ps`.
      return 'alive';
    }

    try {
      const output = execSync(`ps -p ${pid} -o lstart=`, { encoding: 'utf-8', timeout: 2000, env: { ...process.env, LC_TIME: 'C' } }).trim();
      if (output) {
        const processStartMs = Date.parse(output);
        const launchMs = Date.parse(launchStartedAt);
        if (Number.isFinite(processStartMs) && Number.isFinite(launchMs)) {
          // If process started more than 60s after our recorded launch, it's a different process.
          if (processStartMs > launchMs + 60_000) {
            return 'not-found';
          }
        }
      }
    } catch {
      // ps command failed — fall through to 'alive' (conservative).
    }
  }

  return 'alive';
}

function deriveSessionHealth(args: {
  launchPid: number | null;
  terminalState: AgentTerminalSession['terminalState'];
  lastUpdatedAt: string | null;
  launchStartedAt?: string | null;
}): Pick<AgentTerminalSession, 'liveness' | 'stuckState' | 'stuckReason'> {
  const { launchPid, terminalState, lastUpdatedAt, launchStartedAt } = args;
  const liveness = probePidLiveness(launchPid, launchStartedAt);

  if (terminalState === 'completed' || terminalState === 'failed') {
    return {
      liveness,
      stuckState: 'none',
      stuckReason: null,
    };
  }

  const updatedAtMs = parseTimestamp(lastUpdatedAt);
  const ageMs = updatedAtMs === null ? null : Math.max(0, Date.now() - updatedAtMs);

  if (liveness === 'alive' && ageMs !== null && ageMs >= SUSPECTED_STUCK_AFTER_MS) {
    return {
      liveness,
      stuckState: 'suspected-stuck',
      stuckReason: 'PID is still alive after 20m without terminal completion.',
    };
  }

  if (liveness === 'not-found' && ageMs !== null && ageMs >= ORPHANED_GRACE_MS) {
    return {
      liveness,
      stuckState: 'orphaned',
      stuckReason: 'No terminal completion observed and the launched PID is no longer present.',
    };
  }

  return {
    liveness,
    stuckState: 'none',
    stuckReason: null,
  };
}

function mapLaunchState(value: string | null | undefined): AgentTerminalSession['launchState'] {
  switch (value) {
    case 'started':
    case 'completed':
    case 'failed':
    case 'dry-run':
    case 'skipped':
      return value;
    case 'pending':
      return 'queued';
    default:
      return 'unknown';
  }
}

function mapTerminalState(
  value: string | null | undefined,
  launchState: AgentTerminalSession['launchState'],
): AgentTerminalSession['terminalState'] {
  switch (value) {
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'running':
    case 'started':
      return 'running';
    default:
      if (launchState === 'failed') {
        return 'failed';
      }
      if (launchState === 'started' || launchState === 'completed') {
        return 'running';
      }
      if (launchState === 'dry-run' || launchState === 'queued' || launchState === 'skipped') {
        return 'pending';
      }
      return 'unknown';
  }
}

function mapSessionSeverity(
  launchState: AgentTerminalSession['launchState'],
  terminalState: AgentTerminalSession['terminalState'],
  stuckState: AgentTerminalSession['stuckState'],
  parseError: string | null,
): AgentTerminalSession['severity'] {
  if (
    parseError ||
    launchState === 'failed' ||
    terminalState === 'failed' ||
    stuckState === 'orphaned'
  ) {
    return 'error';
  }
  if (
    stuckState === 'suspected-stuck' ||
    terminalState === 'running' ||
    launchState === 'started'
  ) {
    return 'warning';
  }
  if (terminalState === 'completed' || launchState === 'completed') {
    return 'success';
  }
  return 'info';
}

function severityRank(value: GuardrailSeverity): number {
  switch (value) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}

function parseGuardrailStatus(
  value: unknown,
): GuardrailObservation['status'] {
  switch (value) {
    case 'allowed':
    case 'passed':
    case 'denied':
    case 'internal-bypass':
      return value === 'passed' ? 'allowed' : value;
    default:
      return 'malformed';
  }
}

function parseGuardrailViolations(
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

function deriveGuardrailObservationSummary(args: {
  status: GuardrailObservation['status'];
  parseError: string | null;
  launchSeam: string | null;
  violations: GuardrailViolation[];
}): string {
  const { status, parseError, launchSeam, violations } = args;
  if (parseError) {
    return `Malformed guardrail receipt: ${parseError}`;
  }
  if (violations.length > 0) {
    return violations[0]?.message ?? 'Guardrail violations were recorded.';
  }
  if (status === 'denied') {
    return 'Launch denied by repository guardrails.';
  }
  if (status === 'internal-bypass') {
    return launchSeam
      ? `Approved internal bypass attested through ${launchSeam}.`
      : 'Approved internal bypass attested for this runtime.';
  }
  return 'Guardrail receipt recorded an allowed launch.';
}

function deriveGuardrailObservationSeverity(args: {
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

function inferGuardrailIdentity(receiptFile: string): {
  agentId: string;
  instanceId: string | null;
  sessionId: string | null;
} {
  const stem = receiptFile.replace(/\.json$/u, '');
  const parallelMatch = /^software-engineer-(.+)$/u.exec(stem);
  if (parallelMatch?.[1]) {
    return {
      agentId: 'software-engineer',
      instanceId: parallelMatch[1],
      sessionId: `parallel:${parallelMatch[1]}`,
    };
  }

  return {
    agentId: stem,
    instanceId: null,
    sessionId: `role:${stem}`,
  };
}

async function readGuardrailObservations(
  fsAdapter: ReadOnlyRepoFs,
): Promise<GuardrailObservation[]> {
  if (!(await pathExists(GUARDRAIL_RECEIPTS_DIR, fsAdapter))) {
    return [];
  }

  const receiptFiles = (await fsAdapter.readdir(GUARDRAIL_RECEIPTS_DIR))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const observations: GuardrailObservation[] = [];

  for (const receiptFile of receiptFiles) {
    const receiptPath = join(GUARDRAIL_RECEIPTS_DIR, receiptFile);
    const relativePath = toRepoRelativePath(receiptPath);
    const { payload, parseError } = await readJsonObjectIfPresent(
      receiptPath,
      fsAdapter,
    );
    const inferredIdentity = inferGuardrailIdentity(receiptFile);
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

    observations.push({
      receiptPath: relativePath,
      sessionId: instanceId
        ? `parallel:${instanceId}`
        : inferredIdentity.sessionId,
      agentId,
      agentLabel: getAgentLabel(agentId, instanceId),
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

function buildGuardrailSummary(
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

function mergeGuardrailStateIntoSessions(
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

function getLatestTimestamp(...values: Array<string | null | undefined>): string | null {
  const candidates = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort().at(-1) ?? null;
}

function parseSessionEntry(
  payload: JsonObject | null,
  fallbackAgentId: string,
  parseError?: string | null,
): AgentTerminalSession {
  const agentId = stringOrNull(payload?.agent_id) ?? fallbackAgentId;
  const launchPayload = asJsonObject(payload?.launch);
  const terminalPayload = asJsonObject(payload?.terminal);
  const launchState = mapLaunchState(stringOrNull(launchPayload?.status));
  const terminalState = mapTerminalState(stringOrNull(terminalPayload?.status), launchState);
  const launchPid = numberOrNull(launchPayload?.pid);
  const startedAt = stringOrNull(launchPayload?.started_at);
  const lastUpdatedAt = getLatestTimestamp(
    stringOrNull(terminalPayload?.completed_at),
    startedAt,
  );
  const health = deriveSessionHealth({
    launchPid,
    terminalState,
    lastUpdatedAt,
    launchStartedAt: startedAt,
  });
  const latestOutputLines = stringArrayOrEmpty(payload?.latest_output_lines);
  const launchPhase = stringOrNull(payload?.launch_phase);
  const sessionId = startedAt ? `role:${agentId}:${startedAt}` : `role:${agentId}`;

  return {
    taskId: stringOrNull(payload?.task_id),
    agentId,
    agentLabel: launchPhase
      ? `${getAgentLabel(agentId, null)} — ${launchPhase}`
      : getAgentLabel(agentId, null),
    sessionId,
    instanceId: null,
    launchPid,
    liveness: health.liveness,
    stuckState: health.stuckState,
    stuckReason: health.stuckReason,
    sliceId: null,
    slicePath: null,
    launchState,
    terminalState,
    lastUpdatedAt,
    latestOutputLines:
      latestOutputLines.length > 0
        ? latestOutputLines
        : splitOutputLines(parseError ? `Receipt parse error: ${parseError}` : null),
    stdoutLogPath: null,
    stderrLogPath: null,
    severity: mapSessionSeverity(launchState, terminalState, health.stuckState, parseError ?? null),
  };
}

async function readRoleAgentTerminalSessions(
  fsAdapter: ReadOnlyRepoFs,
): Promise<AgentTerminalSession[]> {
  if (!(await pathExists(ROLE_RUNTIME_SESSIONS_DIR, fsAdapter))) {
    return [];
  }

  const receiptFiles = (await fsAdapter.readdir(ROLE_RUNTIME_SESSIONS_DIR)).filter((name) => name.endsWith('.json'));
  const sessions: AgentTerminalSession[] = [];

  for (const receiptFile of receiptFiles) {
    const receiptPath = join(ROLE_RUNTIME_SESSIONS_DIR, receiptFile);
    const { payload, parseError } = await readJsonObjectIfPresent(receiptPath, fsAdapter);
    const fallbackAgentId = receiptFile.replace(/\.json$/u, '');

    // Parse previous sessions from history so the watcher can emit
    // "completed"/"failed" events even after the file was overwritten.
    const history = payload?.session_history;
    if (Array.isArray(history)) {
      for (const entry of history) {
        if (entry != null && typeof entry === 'object' && !Array.isArray(entry)) {
          sessions.push(parseSessionEntry(entry as JsonObject, fallbackAgentId));
        }
      }
    }

    sessions.push(parseSessionEntry(payload, fallbackAgentId, parseError));
  }

  return sessions;
}

function buildTaskHealthRollup(agentTerminalSessions: AgentTerminalSession[]): TaskHealthRollup {
  const observedSessionCount = agentTerminalSessions.length;
  const runningCount = agentTerminalSessions.filter((session) => session.terminalState === 'running').length;
  const completedCount = agentTerminalSessions.filter((session) => session.terminalState === 'completed').length;
  const failedCount = agentTerminalSessions.filter((session) => session.terminalState === 'failed').length;
  const suspectedStuckCount = agentTerminalSessions.filter((session) => session.stuckState === 'suspected-stuck').length;
  const orphanedCount = agentTerminalSessions.filter((session) => session.stuckState === 'orphaned').length;
  const aliveCount = agentTerminalSessions.filter((session) => session.liveness === 'alive').length;
  const missingPidCount = agentTerminalSessions.filter((session) => session.liveness === 'not-found').length;
  const unknownPidCount = agentTerminalSessions.filter((session) => session.liveness === 'unknown').length;

  let status: TaskHealthRollup['status'] = 'healthy';
  let summary = `${runningCount} running, ${completedCount} completed, no liveness alerts.`;

  if (observedSessionCount === 0) {
    status = 'idle';
    summary = 'No runtime sessions observed yet.';
  } else if (orphanedCount > 0 || failedCount > 0) {
    status = 'critical';
    summary = `${orphanedCount} orphaned and ${failedCount} failed session(s) need operator review.`;
  } else if (suspectedStuckCount > 0) {
    status = 'attention';
    summary = `${suspectedStuckCount} session(s) may be stuck while ${runningCount} runtime session(s) remain active.`;
  }

  return {
    status,
    summary,
    observedSessionCount,
    runningCount,
    completedCount,
    failedCount,
    suspectedStuckCount,
    orphanedCount,
    aliveCount,
    missingPidCount,
    unknownPidCount,
  };
}

function selectSessionsForActiveTask(
  activeTaskId: string | null,
  agentTerminalSessions: AgentTerminalSession[],
): AgentTerminalSession[] {
  if (!activeTaskId) {
    return agentTerminalSessions;
  }

  const directMatches = agentTerminalSessions.filter(
    (session) => session.taskId === activeTaskId,
  );
  if (directMatches.length > 0) {
    return directMatches;
  }

  return agentTerminalSessions.filter((session) => session.taskId === null);
}

async function buildTaskLifecycleFeed(args: {
  fsAdapter: ReadOnlyRepoFs;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  professionalTask: string | null;
  currentState: LifecycleState;
  agentTerminalSessions: AgentTerminalSession[];
  guardrailSummary: GuardrailSummary;
  recoveryState: TaskRecoveryState | null;
}): Promise<TaskLifecycleFeed | null> {
  const {
    fsAdapter,
    activeTaskId,
    activeTaskTitle,
    professionalTask,
    currentState,
    agentTerminalSessions,
    guardrailSummary,
    recoveryState,
  } = args;

  if (!activeTaskId && !activeTaskTitle && agentTerminalSessions.length === 0) {
    return null;
  }

  const scopedSessions = selectSessionsForActiveTask(
    activeTaskId,
    agentTerminalSessions,
  );
  let parallelOkContent: string | null = null;
  try { parallelOkContent = await fsAdapter.readFile(PARALLEL_OK_PATH, 'utf-8'); } catch {}
  // Strip HTML comments before checking — the template itself contains "Complex"
  // in a comment that would otherwise false-positive. Mirror the backend's
  // parallelOkHasActiveApproval logic: requires "complex", rejects if "simple" present.
  const strippedParallelOk = parallelOkContent?.replace(/<!--[\s\S]*?-->/g, '') ?? '';
  const parallelizationEnabled =
    scopedSessions.some((session) => session.instanceId !== null) ||
    (/\bcomplex\b/i.test(strippedParallelOk) && !/\bsimple\b/i.test(strippedParallelOk));
  const startedAt = scopedSessions
    .map((session) => session.lastUpdatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(0) ?? null;
  const lastUpdatedAt = getLatestTimestamp(...scopedSessions.map((session) => session.lastUpdatedAt));
  const taskHealth = buildTaskHealthRollup(scopedSessions);

  return {
    taskId: activeTaskId,
    taskTitle: activeTaskTitle,
    taskKind: extractMetadataValue(professionalTask, 'Task Kind') || null,
    workflowStage: currentState,
    activePath: null,
    parallelizationEnabled,
    startedAt,
    lastUpdatedAt,
    sourceArtifact: 'AgentWorkSpace/handoffs/professional-task.md',
    taskHealth,
    guardrailSummary,
    recoveryState:
      recoveryState && (!recoveryState.taskId || recoveryState.taskId === activeTaskId)
        ? recoveryState
        : null,
  };
}

function inferLifecycleState(args: {
  dropboxCount: number;
  pendingCount: number;
  hasCurrentTaskContext: boolean;
}): LifecycleState {
  if (args.pendingCount > 0) {
    return 'active';
  }

  if (args.dropboxCount > 0) {
    return 'queued';
  }

  return 'idle';
}

function inferOperatorStatus(args: {
  activeItem: string | null;
  pendingItems: PendingQueueItem[];
  dropboxCount: number;
  agentTerminalSessions: AgentTerminalSession[];
  activeTaskId: string | null;
}): OperatorStatus {
  const { activeItem, pendingItems, dropboxCount, agentTerminalSessions, activeTaskId } = args;

  const hasRunningSessions = agentTerminalSessions.some((session) =>
    session.terminalState === 'running' || session.launchState === 'started'
  );
  if (activeItem || activeTaskId || hasRunningSessions) {
    return 'RUNNING';
  }

  if (pendingItems.length > 0 || dropboxCount > 0) {
    return 'PENDING';
  }

  return 'OPEN';
}

async function buildArtifactReference(
  label: string,
  path: string,
  kind: 'file' | 'directory',
  fsAdapter: ReadOnlyRepoFs,
): Promise<ArtifactReference> {
  const repoPath = toRepoRelativePath(path);
  const exists = await pathExists(path, fsAdapter);

  if (!exists) {
    return {
      label,
      path: repoPath,
      kind,
      status: 'missing',
      detail: 'Not present in the repo yet.',
    };
  }

  if (kind === 'directory') {
    const count = await countMarkdownFiles(path, fsAdapter);
    return {
      label,
      path: repoPath,
      kind,
      status: count > 0 ? 'present' : 'empty',
      detail: count > 0 ? `${count} markdown artifact(s) available.` : 'No markdown artifacts present yet.',
    };
  }

  const content = await fsAdapter.readFile(path, 'utf-8');
  const heading = extractHeading(content);
  const taskTitle = extractMetadataValue(content, 'Task Title');

  return {
    label,
    path: repoPath,
    kind,
    status: content.trim() ? 'present' : 'empty',
    detail: taskTitle || heading || 'Artifact template is present but does not yet contain task details.',
  };
}

export async function readQueueStatusSnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<QueueStatusResponse> {
  const [dropboxCount, pendingCount, professionalTask, activeItemRaw, errorItemsCount] = await Promise.all([
    countMarkdownFiles(DROPBOX_DIR, fsAdapter),
    countMarkdownFiles(PENDING_DIR, fsAdapter),
    readMarkdownFileIfPresent(join(HANDOFFS_DIR, 'professional-task.md'), fsAdapter),
    readMarkdownFileIfPresent(ACTIVE_ITEM_PATH, fsAdapter),
    countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
  ]);

  const activeTaskId = extractMetadataValue(professionalTask, 'Task ID');
  const activeItem = normalizeActiveItemName(activeItemRaw);
  const pendingQueueItems = await readPendingQueueItems(fsAdapter, activeItem);
  const operatorStatus = inferOperatorStatus({
    activeItem,
    pendingItems: pendingQueueItems,
    dropboxCount,
    agentTerminalSessions: [],
    activeTaskId,
  });
  return {
    action: 'queue.readStatus',
    mode: 'observed',
    queueDepth: dropboxCount,
    pendingReviewCount: pendingCount,
    activeTaskId,
    operatorStatus,
    errorItemsCount: errorItemsCount > 0 ? errorItemsCount : undefined,
    message: `Observed repo queue state: ${dropboxCount} queued, ${pendingCount} pending. Operator status: ${operatorStatus}.`,
  };
}

export async function readObservabilitySnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<ObservabilitySnapshotResponse> {
  const [
    dropboxCount,
    pendingCount,
    professionalTask,
    activeItemRaw,
    rawAgentTerminalSessions,
    guardrails,
    errorItemsCount,
    recoveryState,
  ] =
    await Promise.all([
      countMarkdownFiles(DROPBOX_DIR, fsAdapter),
      countMarkdownFiles(PENDING_DIR, fsAdapter),
      readMarkdownFileIfPresent(join(HANDOFFS_DIR, 'professional-task.md'), fsAdapter),
      readMarkdownFileIfPresent(ACTIVE_ITEM_PATH, fsAdapter),
      readRoleAgentTerminalSessions(fsAdapter),
      readGuardrailObservations(fsAdapter),
      countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
      readTaskRecoveryState(fsAdapter),
    ]);

  const guardrailSummary = buildGuardrailSummary(guardrails);
  const agentTerminalSessions = mergeGuardrailStateIntoSessions(
    rawAgentTerminalSessions,
    guardrails,
  );

  const activeItem = normalizeActiveItemName(activeItemRaw);
  const pendingQueueItems = await readPendingQueueItems(
    fsAdapter,
    activeItem,
  );
  const activeTaskId = extractMetadataValue(professionalTask, 'Task ID');
  const activeTaskTitle = extractMetadataValue(professionalTask, 'Task Title');
  const operatorStatus = inferOperatorStatus({
    activeItem,
    pendingItems: pendingQueueItems,
    dropboxCount,
    agentTerminalSessions,
    activeTaskId,
  });
  const currentState = inferLifecycleState({
    dropboxCount,
    pendingCount,
    hasCurrentTaskContext: Boolean(activeTaskId || activeTaskTitle),
  });

  const lifecycle: WorkflowLifecycleEntry[] = [
    {
      state: 'queued',
      observed: dropboxCount > 0,
      detail:
        dropboxCount > 0 ? `${dropboxCount} markdown task(s) currently waiting in AgentWorkSpace/dropbox/.` : 'No queued markdown tasks observed in AgentWorkSpace/dropbox/.',
    },
    {
      state: 'active',
      observed: pendingCount > 0 || Boolean(activeTaskId),
      detail:
        pendingCount > 0 || activeTaskId
          ? `Active workflow context is visible in AgentWorkSpace/pendingitems/ or AgentWorkSpace/handoffs metadata for ${activeTaskId || 'the current task'}.`
          : 'No active AgentWorkSpace/pendingitems/ artifact is currently visible.',
    },
  ];

  const artifactReferences = await Promise.all([
    buildArtifactReference('Professional task handoff', join(HANDOFFS_DIR, 'professional-task.md'), 'file', fsAdapter),
    buildArtifactReference('Retrospective handoff', join(HANDOFFS_DIR, 'retrospective-input.md'), 'file', fsAdapter),
    buildArtifactReference('Implementation steps', IMPLEMENTATION_STEPS_DIR, 'directory', fsAdapter),
  ]);
  const activeTask = await buildTaskLifecycleFeed({
    fsAdapter,
    activeTaskId,
    activeTaskTitle,
    professionalTask,
    currentState,
    agentTerminalSessions,
    guardrailSummary,
    recoveryState,
  });

  return {
    action: 'observability.readSnapshot',
    mode: 'read-only',
    message:
      'Repo observability reflects queue and artifact truth only. The desktop shell does not author workflow-policy artifacts.',
    queueDepth: dropboxCount,
    pendingReviewCount: pendingCount,
    activeTaskId,
    activeTaskTitle,
    currentState,
    operatorStatus,
    pendingQueueItems,
    errorItemsCount: errorItemsCount > 0 ? errorItemsCount : undefined,
    activeTask,
    agentTerminalSessions,
    guardrailSummary,
    guardrails,
    recoveryState,
    lifecycle,
    artifactReferences,
    policyBoundary:
      'Repo artifacts remain authoritative. Desktop recovery controls may mutate queue claims and pending items, but they never author handoff summaries directly.',
  };
}
