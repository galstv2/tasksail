import { join, resolve } from 'node:path';
import { writeFile as fsWriteFile } from 'node:fs/promises';

import type {
  ContextPackReseedExecutionResult,
  ContextPackReseedPayload,
  ContextPackReseedResponse,
  DesktopInvokeResult,
} from '../../../src/shared/desktopContract';
import { RESEED_IN_PROGRESS_ERROR_CODE } from '../../../src/shared/desktopContractContextPack';
import {
  REPO_CONTEXT_APP_PATH,
  toRepoRelativePath,
} from '../shared';
import { numberOrNull, stringOrNull } from '../../utils';
import { rebuildAgentMirror } from '../../../../../backend/platform/context-pack/rebuildAgentMirror';
import { REPO_ROOT } from '../../paths';
import { listAvailableContextPacks } from '../catalog';
import { type ApprovedContextPackDirReader } from '../shared';
import {
  runContextPackReseedCommand,
  type ContextPackReseedRunner,
} from './shared';
import { createLogger } from '../../log/logger';

// Re-export so it's available from main.contextPackActions barrel.
export { runContextPackReseedCommand };
export type { ContextPackReseedRunner };

const log = createLogger('electron/contextPackActions/reseed');

export function buildContextPackReseedArgs(payload: ContextPackReseedPayload): string[] {
  return [REPO_CONTEXT_APP_PATH, 'seed', '--context-pack-dir', payload.contextPackDir, '--format', 'json'];
}

function normalizeContextPackReseedResult(payload: unknown, contextPackDir: string): ContextPackReseedExecutionResult {
  const report = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const cs = typeof report.conventions_summary === 'object' && report.conventions_summary !== null
    ? (report.conventions_summary as Record<string, unknown>) : {};
  const wc = typeof report.workspace_counts === 'object' && report.workspace_counts !== null
    ? (report.workspace_counts as Record<string, unknown>) : {};
  return {
    contextPackDir: resolve(contextPackDir),
    overallStatus: stringOrNull(report.overall_status) ?? 'unknown',
    reportPath: stringOrNull(report.report_path),
    seededRepoCount: typeof report.seeded_repo_count === 'number' ? report.seeded_repo_count : 0,
    blockedRepoCount: typeof report.blocked_repo_count === 'number' ? report.blocked_repo_count : 0,
    conventionsSummaryStatus: stringOrNull(cs.status) ?? null,
    conventionsPolicy: 'only-if-missing',
    workspaceFolderCount: numberOrNull(wc.folder_count),
    workspaceFileCount: numberOrNull(wc.file_count),
  };
}

function normalizeReseedInProgressError(payload: unknown): { message: string; details: string[] } | null {
  const parsed = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;
  if (parsed?.error !== RESEED_IN_PROGRESS_ERROR_CODE) return null;
  const pid = numberOrNull(parsed.pid);
  const staleAfterSeconds = numberOrNull(parsed.stale_after_seconds);
  const details = [
    `pid=${pid !== null ? String(pid) : 'unknown'}`,
    `host=${stringOrNull(parsed.host) ?? 'unknown'}`,
    `started_at=${stringOrNull(parsed.started_at) ?? 'unknown'}`,
    `same_host=${typeof parsed.same_host === 'boolean' ? String(parsed.same_host) : 'unknown'}`,
    `stale_after_seconds=${staleAfterSeconds !== null ? String(staleAfterSeconds) : 'unknown'}`,
  ];
  return {
    message: stringOrNull(parsed.message) ?? 'A context-pack reseed is already in progress.',
    details,
  };
}

async function updateSyncStateAfterReseed(
  reseedResult: ContextPackReseedExecutionResult,
): Promise<void> {
  try {
    const countsPath = join(reseedResult.contextPackDir, 'workspace-counts.json');
    await fsWriteFile(
      countsPath,
      JSON.stringify({
        repo_count: reseedResult.seededRepoCount + reseedResult.blockedRepoCount,
        folder_count: reseedResult.workspaceFolderCount,
        file_count: reseedResult.workspaceFileCount,
        updated_at: new Date().toISOString(),
      }, null, 2) + '\n',
      'utf-8',
    );
  } catch (err: unknown) {
    log.warn('context-pack.reseed.workspace-counts.persist.failed', {
      contextPackDir: reseedResult.contextPackDir,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await rebuildAgentMirror(REPO_ROOT, reseedResult.contextPackDir);
  } catch (err: unknown) {
    log.warn('context-pack.reseed.mirror-rebuild.failed', {
      contextPackDir: reseedResult.contextPackDir,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

async function listApprovedContextPackDirs(): Promise<Set<string>> {
  const catalog = await listAvailableContextPacks();
  return new Set(catalog.contextPacks.map((entry) => resolve(entry.contextPackDir)));
}

export async function executeContextPackReseedAction(
  payload: ContextPackReseedPayload,
  runner: ContextPackReseedRunner = runContextPackReseedCommand,
  readApprovedContextPackDirs: ApprovedContextPackDirReader = listApprovedContextPackDirs,
): Promise<DesktopInvokeResult> {
  const normalizedContextPackDir = resolve(payload.contextPackDir);
  const approvedContextPackDirs = await readApprovedContextPackDirs();
  if (!approvedContextPackDirs.has(normalizedContextPackDir)) {
    return {
      ok: false,
      action: 'contextPack.reseed',
      error: 'Context-pack reseed is limited to approved catalog entries discovered through the desktop shell.',
    };
  }

  try {
    const result = await runner(buildContextPackReseedArgs({ contextPackDir: normalizedContextPackDir }));
    const normalized = normalizeContextPackReseedResult(JSON.parse(result.stdout), normalizedContextPackDir);
    await updateSyncStateAfterReseed(normalized);
    const response: ContextPackReseedResponse = {
      action: 'contextPack.reseed',
      mode: 'reseeded',
      message: 'Context-pack reseed completed through the approved repo-context seed seam. Conventions memo generation remains only-if-missing.',
      commandPath: toRepoRelativePath(REPO_CONTEXT_APP_PATH),
      result: normalized,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const stdout = typeof error === 'object' && error !== null && 'stdout' in error
      ? String((error as { stdout?: unknown }).stdout ?? '') : '';
    const stderr = typeof error === 'object' && error !== null && 'stderr' in error
      ? String((error as { stderr?: unknown }).stderr ?? '') : '';
    if (stdout.trim().length > 0) {
      try {
        const parsed = JSON.parse(stdout);
        const reseedConflict = normalizeReseedInProgressError(parsed);
        if (reseedConflict) {
          return {
            ok: false,
            action: 'contextPack.reseed',
            error: RESEED_IN_PROGRESS_ERROR_CODE,
            details: [`message=${reseedConflict.message}`, ...reseedConflict.details],
          };
        }
        const normalized = normalizeContextPackReseedResult(parsed, normalizedContextPackDir);
        return {
          ok: false,
          action: 'contextPack.reseed',
          error: stderr || `Context-pack reseed failed with overall_status ${normalized.overallStatus}.`,
          details: [`overall_status=${normalized.overallStatus}`, `conventions_summary_status=${normalized.conventionsSummaryStatus ?? 'unknown'}`],
        };
      } catch { /* fall through */ }
    }
    return {
      ok: false,
      action: 'contextPack.reseed',
      error: stderr || (error instanceof Error ? error.message : 'Context-pack reseed failed unexpectedly.'),
    };
  }
}
