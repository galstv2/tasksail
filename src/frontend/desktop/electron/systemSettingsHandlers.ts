// Electron main-process handlers for the System Settings desktop actions. These
// call the backend platform-config read/save helpers with the fixed REPO_ROOT
// only — the renderer never supplies file paths. Backend validation, stale-hash
// conflicts, runtime repair, and partial-propagation failures are mapped into
// DesktopInvokeResult shapes the renderer already understands.
//
// Active-work lock: while a task is running, platform settings are read-only.
// The lock is reported on read (tasksActive) for the UI and re-enforced on save
// (active_work_blocked) as the hard guarantee — a settings change must never land
// mid-task, since most settings only take effect on a TaskSail restart.

import {
  readSystemSettings,
  saveSystemSettings,
  SystemSettingsSaveError,
} from '../../../backend/platform/platform-config/index.js';
import type {
  SystemSettingsReadResult,
  SystemSettingsSaveResult,
} from '../../../backend/platform/platform-config/index.js';
import { checkActiveWorkGuard } from '../../../backend/platform/agent-runner/reinforcementWrite.js';
import type {
  DesktopInvokeResult,
  SystemSettingsReadResponse,
  SystemSettingsSaveRequest,
  SystemSettingsSaveResponse,
} from '../src/shared/desktopContract';
import {
  ERROR_CODE_ACTIVE_WORK_BLOCKED,
  ERROR_CODE_VERSION_CONFLICT,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

const ACTIVE_WORK_MESSAGE =
  'Platform settings cannot be changed while a task is running. Wait for active tasks to finish, then try again.';

// Injectable so the active-work lock is testable without a live queue.
export type SystemSettingsActiveWorkProbe = (repoRoot: string) => Promise<boolean>;

const defaultActiveWorkProbe: SystemSettingsActiveWorkProbe = async (repoRoot) => {
  const result = await checkActiveWorkGuard({ repoRoot });
  return !result.allowed;
};

export interface SystemSettingsHandlerOptions {
  repoRoot?: string;
  checkActiveWork?: SystemSettingsActiveWorkProbe;
}

function fail(
  action: string,
  error: string,
  extra?: { errorCode?: string; details?: string[] },
): DesktopInvokeResult {
  return {
    ok: false,
    action,
    error,
    ...(extra?.errorCode ? { errorCode: extra.errorCode } : {}),
    ...(extra?.details && extra.details.length > 0 ? { details: extra.details } : {}),
  };
}

function buildReadResponse(
  result: SystemSettingsReadResult,
  tasksActive: boolean,
): SystemSettingsReadResponse {
  return {
    action: 'systemSettings.read',
    mode: 'read-only',
    message: 'Loaded platform settings.',
    defaultConfigPath: result.defaultConfigPath,
    runtimeConfigPath: result.runtimeConfigPath,
    defaultFileHash: result.defaultFileHash,
    runtimeFileHash: result.runtimeFileHash,
    config: result.config,
    runtimeConfig: result.runtimeConfig,
    runtimeStatus: result.runtimeStatus,
    runtimeWarning: result.runtimeWarning,
    tasksActive,
    envOverrides: result.envOverrides,
  };
}

function buildSaveResponse(
  result: SystemSettingsSaveResult,
  tasksActive: boolean,
): SystemSettingsSaveResponse {
  return {
    action: 'systemSettings.save',
    mode: 'saved',
    message: 'Saved platform settings.',
    defaultConfigPath: result.defaultConfigPath,
    runtimeConfigPath: result.runtimeConfigPath,
    defaultFileHash: result.defaultFileHash,
    runtimeFileHash: result.runtimeFileHash,
    config: result.config,
    runtimeConfig: result.runtimeConfig,
    runtimeStatus: 'valid',
    runtimeWarning: result.runtimeWarning,
    tasksActive,
    envOverrides: result.envOverrides,
  };
}

export function createSystemSettingsHandlers(options: SystemSettingsHandlerOptions = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const probeActiveWork = options.checkActiveWork ?? defaultActiveWorkProbe;

  return {
    read: async (): Promise<DesktopInvokeResult> => {
      try {
        const [result, tasksActive] = await Promise.all([
          readSystemSettings(repoRoot),
          probeActiveWork(repoRoot),
        ]);
        return { ok: true, response: buildReadResponse(result, tasksActive) };
      } catch (err: unknown) {
        return fail('systemSettings.read', err instanceof Error ? err.message : String(err));
      }
    },
    save: async (
      payload: SystemSettingsSaveRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        // Hard guarantee: never write settings while a task is running.
        if (await probeActiveWork(repoRoot)) {
          return fail('systemSettings.save', ACTIVE_WORK_MESSAGE, {
            errorCode: ERROR_CODE_ACTIVE_WORK_BLOCKED,
          });
        }
        const result = await saveSystemSettings(repoRoot, {
          baseDefaultFileHash: payload.baseDefaultFileHash,
          config: payload.config,
        });
        return { ok: true, response: buildSaveResponse(result, false) };
      } catch (err: unknown) {
        if (err instanceof SystemSettingsSaveError) {
          return fail('systemSettings.save', err.message, {
            errorCode: err.code === 'conflict' ? ERROR_CODE_VERSION_CONFLICT : undefined,
            details: err.details,
          });
        }
        return fail('systemSettings.save', err instanceof Error ? err.message : String(err));
      }
    },
  };
}

const defaultSystemSettingsHandlers = createSystemSettingsHandlers();

export const readSystemSettingsAction = defaultSystemSettingsHandlers.read;
export const saveSystemSettingsAction = defaultSystemSettingsHandlers.save;
