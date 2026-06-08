import { readFile as fsReadFile, readdir as fsReaddir } from 'node:fs/promises';
import { join } from 'node:path';

import { REPO_ROOT } from '../paths';
import { getNodeErrorCode } from '../main.textUtils';
import { listAvailableContextPacks } from '../contextPack';
import {
  getCurrentActiveContextPackTaskScope,
  refreshCurrentActiveContextPackTaskScope,
} from '../contextPack/taskVisibility';
import { refreshRuntimeStreamState } from '../runtime/runtimeStream';
import {
  emitStreamEvent,
  refreshStreamTaskMetadataForScope,
} from '../runtime/stream';
import { refreshTerminalScopeCaches } from '../runtime/terminalScopeRefresh';
import { createLogger } from '../log/logger';
import { listActivePipelines } from '../../../../backend/platform/agent-runner/pipelineSupervisor.js';
import { getQueueStatus } from '../../../../backend/platform/queue';

const log = createLogger('electron/main');

export class StartupRecoveryService {
  async cleanupStalePipelineState(): Promise<void> {
    const runtimeTasksDir = join(REPO_ROOT, '.platform-state', 'runtime', 'tasks');
    let taskIds: string[];
    try {
      taskIds = await fsReaddir(runtimeTasksDir);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
        return;
      }
      throw error;
    }

    const receiptPaths: string[] = [];
    for (const taskId of taskIds) {
      const roleSessionsDir = join(runtimeTasksDir, taskId, 'role-sessions');
      let receiptFiles: string[];
      try {
        receiptFiles = await fsReaddir(roleSessionsDir);
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        if (errorCode === 'ENOENT' || errorCode === 'ENOTDIR') {
          continue;
        }
        throw error;
      }
      for (const file of receiptFiles) {
        if (!file.endsWith('.json')) continue;
        receiptPaths.push(join(roleSessionsDir, file));
      }
    }

    for (const receiptPath of receiptPaths) {
      try {
        const content = await fsReadFile(receiptPath, 'utf-8');
        const receipt = JSON.parse(content) as {
          agent_id?: string;
          launch?: { pid?: number };
          terminal?: unknown;
        };
        if (receipt.terminal) continue;

        const pid = receipt.launch?.pid;
        if (!pid || pid <= 0) continue;

        try {
          process.kill(pid, 0);
          process.kill(pid, 'SIGTERM');
          emitStreamEvent({
            message: `Killed orphaned agent process (pid: ${pid}, agent: ${receipt.agent_id ?? receiptPath}).`,
            source: 'startup.recovery',
            role: 'system',
            severity: 'warning',
          });
        } catch (error: unknown) {
          if (getNodeErrorCode(error) !== 'ESRCH') {
            log.warn('startup.recovery.agent-process.kill.failed', {
              receiptPath,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error: unknown) {
        log.warn('startup.recovery.receipt.read.failed', {
          receiptPath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  schedulePipelineAutoStart(): void {
    void (async () => {
      try {
        if (listActivePipelines().length > 0) {
          return;
        }

        try {
          const { changed } = await refreshCurrentActiveContextPackTaskScope(listAvailableContextPacks);
          if (changed) {
            await refreshTerminalScopeCaches();
          } else {
            await refreshStreamTaskMetadataForScope(getCurrentActiveContextPackTaskScope());
            await refreshRuntimeStreamState();
          }
        } catch (error: unknown) {
          log.warn('terminal.pre-pipeline-refresh.failed', {
            reason: error instanceof Error ? error.message : String(error),
          });
          try {
            await refreshStreamTaskMetadataForScope(getCurrentActiveContextPackTaskScope());
          } catch (error: unknown) {
            log.warn('terminal.task-metadata-refresh.failed', {
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          await refreshRuntimeStreamState();
        }

        const status = await getQueueStatus(REPO_ROOT);
        const firstActive = status.activeTasks[0];
        if (!firstActive) {
          emitStreamEvent({
            message: 'pipeline.autoStart: no active pending item; skipping launch',
            source: 'pipeline.autoStart',
            role: 'workflow',
            severity: 'info',
          });
          return;
        }
        const taskId = firstActive.taskId;

        emitStreamEvent({
          message: 'Launching active-task pipeline for pending workflow item.',
          source: 'pipeline.autoStart',
          role: 'workflow',
        });

        await import('../../../../backend/platform/agent-runner/pipeline/sequencer.js')
          .then(({ runPipelineSequence }) => runPipelineSequence({ repoRoot: REPO_ROOT, startAt: 'alice', taskId }))
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            const alreadyRunning = message.includes('Another pipeline run is already active');
            emitStreamEvent({
              message: alreadyRunning
                ? `Pipeline already running: ${message}`
                : `Failed to start agent pipeline: ${message}`,
              source: 'pipeline.autoStart',
              role: 'system',
              severity: alreadyRunning ? 'warning' : 'error',
            });
          });
      } catch (error: unknown) {
        log.error(
          'pipeline.autoStart.failed',
          error instanceof Error ? error : { reason: String(error) },
        );
      }
    })();
  }
}

const defaultStartupRecoveryService = new StartupRecoveryService();

export function cleanupStalePipelineState(): Promise<void> {
  return defaultStartupRecoveryService.cleanupStalePipelineState();
}

export function schedulePipelineAutoStart(): void {
  defaultStartupRecoveryService.schedulePipelineAutoStart();
}
