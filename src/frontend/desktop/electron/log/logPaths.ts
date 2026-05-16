import { app } from 'electron';
import path from 'node:path';

import { REPO_ROOT } from '../paths';

export type FrontendLogSource = 'electron' | 'renderer';
export type FrontendWriteLevel = 'info' | 'warn' | 'error';

export function frontendLogsDir(): string {
  if (process.env.LOG_DIR) return process.env.LOG_DIR;

  // Packaged apps should use the OS log location instead of writing beside app resources.
  if (app.isPackaged) return app.getPath('logs');

  return path.join(REPO_ROOT, '.platform-state/logs');
}

export function frontendLogFile(
  source: FrontendLogSource,
  level: FrontendWriteLevel,
  date: Date,
): string {
  return path.join(
    frontendLogsDir(),
    level,
    `frontend-${source}-${yyyymmdd(date)}.jsonl`,
  );
}

export function frontendTaskAgentLogFile(
  taskId: string,
  agentId: string,
): string {
  return path.join(frontendLogsDir(), 'agent', taskId, `${agentId}.jsonl`);
}

export function frontendLogFileWithSuffix(
  basePath: string,
  suffix: number,
): string {
  return basePath.replace(/\.jsonl$/u, `.${suffix}.jsonl`);
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/gu, '');
}
