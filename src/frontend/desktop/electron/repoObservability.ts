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
const ACTIVE_ITEMS_DIR = join(PENDING_DIR, '.active-items');
const ERROR_ITEMS_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'error-items');

// §5.5 F27: TODO — per-taskId mtime cache for incremental aggregate view will be
// populated in §6.0 when subscribeTask/unsubscribeTask are called from the pipeline.
// Not used until §6.0; declared here as a forward-reference placeholder.
// const taskRuntimeMtimeCache = new Map<string, number>();
// const OBSERVABILITY_DEBOUNCE_MS = 200; // TODO §4.4: read from platform config.

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


/** Read active taskIds from the ACTIVE_ITEMS_DIR markers directory. */
async function readActiveTaskIds(fsAdapter: ReadOnlyRepoFs): Promise<string[]> {
  if (!(await pathExists(ACTIVE_ITEMS_DIR, fsAdapter))) {
    return [];
  }
  try {
    const entries = await fsAdapter.readdir(ACTIVE_ITEMS_DIR);
    return entries.filter((f) => !f.endsWith('.completing') && !f.startsWith('.'));
  } catch {
    return [];
  }
}

async function readPendingQueueItems(
  fsAdapter: ReadOnlyRepoFs,
  activeTaskIds: Set<string>,
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
    const taskId = extractMetadataValue(content, 'Task ID');
    const isActive = taskId ? activeTaskIds.has(taskId) : false;
    const state: PendingQueueItem['state'] = isActive ? 'active' : 'pending';
    items.push({
      queueName,
      taskId,
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
  guardrailReceiptsDir: string,
): Promise<GuardrailObservation[]> {
  if (!(await pathExists(guardrailReceiptsDir, fsAdapter))) {
    return [];
  }

  const receiptFiles = (await fsAdapter.readdir(guardrailReceiptsDir))
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
  roleRuntimeSessionsDir: string,
): Promise<AgentTerminalSession[]> {
  if (!(await pathExists(roleRuntimeSessionsDir, fsAdapter))) {
    return [];
  }

  const receiptFiles = (await fsAdapter.readdir(roleRuntimeSessionsDir)).filter((name) => name.endsWith('.json'));
  const sessions: AgentTerminalSession[] = [];

  for (const receiptFile of receiptFiles) {
    const receiptPath = join(roleRuntimeSessionsDir, receiptFile);
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
  /** §5.5: per-task handoffs dir. Defaults to legacy singleton when not supplied. */
  handoffsDir?: string;
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
  // §5.5: derive parallel-ok path from per-task handoffs dir when available.
  const effectiveHandoffsDir = args.handoffsDir ?? join(REPO_ROOT, 'AgentWorkSpace', 'handoffs');
  const parallelOkPath = join(effectiveHandoffsDir, 'parallel-ok.md');
  let parallelOkContent: string | null = null;
  try { parallelOkContent = await fsAdapter.readFile(parallelOkPath, 'utf-8'); } catch {}
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
    // §5.5: sourceArtifact is now per-task; derived from effectiveHandoffsDir.
    sourceArtifact: toRepoRelativePath(join(effectiveHandoffsDir, 'professional-task.md')),
    taskHealth,
    guardrailSummary,
    recoveryState:
      recoveryState && (activeTaskId === null || !recoveryState.taskId || recoveryState.taskId === activeTaskId)
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

/**
 * §5.5: inferOperatorStatus now returns the new OperatorStatus object shape.
 * activeTasks array is populated from active markers in .active-items/;
 * activeTaskId is derived as activeTasks[0]?.taskId ?? null (F39 back-compat scalar).
 */
function inferOperatorStatus(args: {
  activeTaskIds: string[];
  agentTerminalSessions: AgentTerminalSession[];
}): OperatorStatus {
  const { activeTaskIds, agentTerminalSessions } = args;

  // Build activeTasks array from active markers
  const activeTasks: Array<{ taskId: string; phase: string; startedAt: string }> =
    activeTaskIds.map((taskId) => {
      // Phase is derived from the first running session for this task, or 'unknown'
      const session = agentTerminalSessions.find((s) => s.taskId === taskId);
      const phase = session?.launchState === 'started' ? 'running'
        : session?.terminalState === 'running' ? 'running'
        : session?.terminalState === 'completed' ? 'completed'
        : session?.terminalState === 'failed' ? 'failed'
        : 'unknown';
      const startedAt = session?.lastUpdatedAt ?? new Date().toISOString();
      return { taskId, phase, startedAt };
    });

  // F39: back-compat activeTaskId scalar
  const activeTaskId = activeTasks[0]?.taskId ?? null;

  return { activeTasks, activeTaskId };
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
  // §5.5: enumerate ACTIVE_ITEMS_DIR for multi-task support instead of reading singleton .active-item.
  const [dropboxCount, pendingCount, activeTaskIds, errorItemsCount] = await Promise.all([
    countMarkdownFiles(DROPBOX_DIR, fsAdapter),
    countMarkdownFiles(PENDING_DIR, fsAdapter),
    readActiveTaskIds(fsAdapter),
    countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
  ]);

  // Derive activeTaskId for backward-compat scalar from the first active marker (F39).
  const activeTaskId = activeTaskIds[0] ?? null;

  const operatorStatus = inferOperatorStatus({
    activeTaskIds,
    agentTerminalSessions: [],
  });
  return {
    action: 'queue.readStatus',
    mode: 'observed',
    queueDepth: dropboxCount,
    pendingReviewCount: pendingCount,
    activeTaskId,
    operatorStatus,
    errorItemsCount: errorItemsCount > 0 ? errorItemsCount : undefined,
    message: `Observed repo queue state: ${dropboxCount} queued, ${pendingCount} pending. Active tasks: ${activeTaskIds.length}.`,
  };
}

export async function readObservabilitySnapshot(
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<ObservabilitySnapshotResponse> {
  // §5.5: singleton fallback dirs for backward-compat when no per-task runtime exists yet.
  const legacyRoleSessionsDir = join(REPO_ROOT, '.platform-state', 'runtime', 'role-sessions');
  const legacyGuardrailReceiptsDir = join(REPO_ROOT, '.platform-state', 'runtime', 'guardrails');

  const [
    dropboxCount,
    pendingCount,
    activeTaskIds,
    rawAgentTerminalSessions,
    guardrails,
    errorItemsCount,
    recoveryState,
  ] =
    await Promise.all([
      countMarkdownFiles(DROPBOX_DIR, fsAdapter),
      countMarkdownFiles(PENDING_DIR, fsAdapter),
      readActiveTaskIds(fsAdapter),
      // §5.5: pass dir param; legacy singleton path as default until per-task runtime is wired.
      readRoleAgentTerminalSessions(fsAdapter, legacyRoleSessionsDir),
      readGuardrailObservations(fsAdapter, legacyGuardrailReceiptsDir),
      countMarkdownFiles(ERROR_ITEMS_DIR, fsAdapter),
      readTaskRecoveryState(fsAdapter),
    ]);

  const guardrailSummary = buildGuardrailSummary(guardrails);
  const agentTerminalSessions = mergeGuardrailStateIntoSessions(
    rawAgentTerminalSessions,
    guardrails,
  );

  const activeTaskIdSet = new Set(activeTaskIds);
  const pendingQueueItems = await readPendingQueueItems(fsAdapter, activeTaskIdSet);

  const activeTaskId = activeTaskIds[0] ?? null;
  const tasksDir = join(REPO_ROOT, 'AgentWorkSpace', 'tasks');

  const operatorStatus = inferOperatorStatus({
    activeTaskIds,
    agentTerminalSessions,
  });

  let professionalTask: string | null = null;
  let activeTaskTitle: string | null = null;
  if (activeTaskId) {
    const firstTaskHandoffsDir = join(tasksDir, activeTaskId, 'handoffs');
    professionalTask = await readMarkdownFileIfPresent(
      join(firstTaskHandoffsDir, 'professional-task.md'),
      fsAdapter,
    );
    activeTaskTitle = extractMetadataValue(professionalTask, 'Task Title');
  }

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
          ? `Active workflow context is visible in AgentWorkSpace/pendingitems/ or .active-items markers for ${activeTaskId || 'the current task'}.`
          : 'No active AgentWorkSpace/pendingitems/ artifact is currently visible.',
    },
  ];

  const artifactReferences: Array<Awaited<ReturnType<typeof buildArtifactReference>> & { taskId: string | null }> = [];
  const activeTasks: TaskLifecycleFeed[] = [];

  for (const tid of activeTaskIds) {
    const taskHandoffsDir = join(tasksDir, tid, 'handoffs');
    const taskImplStepsDir = join(tasksDir, tid, 'ImplementationSteps');

    const taskProfessionalTask = tid === activeTaskId
      ? professionalTask
      : await readMarkdownFileIfPresent(join(taskHandoffsDir, 'professional-task.md'), fsAdapter);
    const taskTitle = extractMetadataValue(taskProfessionalTask, 'Task Title');

    const [ptRef, retroRef, implRef] = await Promise.all([
      buildArtifactReference('Professional task handoff', join(taskHandoffsDir, 'professional-task.md'), 'file', fsAdapter),
      buildArtifactReference('Retrospective handoff', join(taskHandoffsDir, 'retrospective-input.md'), 'file', fsAdapter),
      buildArtifactReference('Implementation steps', taskImplStepsDir, 'directory', fsAdapter),
    ]);
    artifactReferences.push(
      { ...ptRef, taskId: tid },
      { ...retroRef, taskId: tid },
      { ...implRef, taskId: tid },
    );

    const feed = await buildTaskLifecycleFeed({
      fsAdapter,
      activeTaskId: tid,
      activeTaskTitle: taskTitle,
      professionalTask: taskProfessionalTask,
      currentState,
      agentTerminalSessions,
      guardrailSummary,
      recoveryState,
      handoffsDir: taskHandoffsDir,
    });
    if (feed) {
      activeTasks.push(feed);
    }
  }

  const activeTask = activeTasks[0] ?? null;

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
    activeTasks,
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
