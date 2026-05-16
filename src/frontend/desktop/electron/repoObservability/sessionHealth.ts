import { execSync } from 'node:child_process';

import type { AgentTerminalSession } from '../../src/shared/desktopContract';

import {
  ORPHANED_GRACE_MS,
  SUSPECTED_STUCK_AFTER_MS,
  parseTimestamp,
} from './shared';

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

export function deriveSessionHealth(args: {
  launchPid: number | null;
  terminalState: AgentTerminalSession['terminalState'];
  lastUpdatedAt: string | null;
  launchStartedAt?: string | null;
  monitorUpdatedAt?: string | null;
  monitorStartedAt?: string | null;
  monitorPid?: number | null;
}): Pick<AgentTerminalSession, 'liveness' | 'stuckState' | 'stuckReason'> {
  const {
    launchPid,
    terminalState,
    lastUpdatedAt,
    launchStartedAt,
    monitorUpdatedAt,
    monitorStartedAt,
    monitorPid,
  } = args;
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

  const monitorUpdatedAtMs = parseTimestamp(monitorUpdatedAt);
  const monitorIsRecent = monitorUpdatedAtMs !== null &&
    Date.now() - monitorUpdatedAtMs < ORPHANED_GRACE_MS;
  const monitorIsActive = monitorIsRecent &&
    monitorPid !== null &&
    monitorPid !== undefined &&
    monitorPid > 0 &&
    probePidLiveness(monitorPid, monitorStartedAt) === 'alive';

  if (liveness === 'not-found' && ageMs !== null && ageMs >= ORPHANED_GRACE_MS) {
    if (monitorIsActive) {
      return {
        liveness,
        stuckState: 'none',
        stuckReason: null,
      };
    }
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

export function mapLaunchState(value: string | null | undefined): AgentTerminalSession['launchState'] {
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

export function mapTerminalState(
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

export function mapSessionSeverity(
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
