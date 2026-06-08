import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

import type { StreamEventOptions } from '../runtime/stream';
import type { WritableRepoFs } from '../utils';
import { getNodeErrorCode } from '../main.textUtils';
import { createLogger } from '../log/logger';
import { withTaskTerminalEventsLock } from '../../../../backend/platform/core/taskTerminalEventsLock.js';

const log = createLogger('electron/main.taskTerminalTranscript');

export type TaskTerminalTranscriptEventInput = {
  taskId: string;
  eventId: string;
  source: string;
  role: StreamEventOptions['role'];
  severity: StreamEventOptions['severity'];
  message: string;
  visible?: boolean;
  actorName?: string;
  sessionContext?: StreamEventOptions['sessionContext'];
  extra?: Record<string, unknown>;
};

export type TaskTerminalTranscriptFs = WritableRepoFs;

export function terminalEventsPath(repoRoot: string, taskId: string): string {
  return join(
    repoRoot,
    '.platform-state',
    'runtime',
    'tasks',
    taskId,
    'terminal-events.json',
  );
}

export async function appendTaskTerminalTranscriptEvent(
  fsAdapter: TaskTerminalTranscriptFs,
  repoRoot: string,
  input: TaskTerminalTranscriptEventInput,
): Promise<void> {
  if (!hasRealTaskId(input.taskId)) {
    return;
  }

  const filePath = terminalEventsPath(repoRoot, input.taskId);
  try {
    await fsAdapter.mkdir(dirname(filePath), { recursive: true });
    await withTaskTerminalEventsLock(repoRoot, input.taskId, async () => {
      const events = await readExistingEvents(fsAdapter, filePath);
      const eventIds = new Set(
        events
          .filter((item): item is { eventId: string } => (
            isRecord(item) && typeof item.eventId === 'string'
          ))
          .map((item) => item.eventId),
      );

      if (!eventIds.has(input.eventId)) {
        events.push({
          eventId: input.eventId,
          source: input.source,
          role: input.role,
          severity: input.severity,
          visible: input.visible ?? true,
          message: input.message,
          createdAt: new Date().toISOString(),
          ...(input.actorName ? { actorName: input.actorName } : {}),
          ...(input.sessionContext ? { sessionContext: input.sessionContext } : {}),
          ...(input.extra ? { extra: input.extra } : {}),
        });
      }

      await writeTranscriptAtomic(fsAdapter, filePath, JSON.stringify({ events }, null, 2) + '\n');
    }, fsAdapter);
  } catch (err) {
    log.warn('task_terminal_transcript.write.failed', {
      taskId: input.taskId,
      eventId: input.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function writeTranscriptAtomic(
  fsAdapter: TaskTerminalTranscriptFs,
  filePath: string,
  contents: string,
): Promise<void> {
  const tempName = `${basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
  const tempPath = join(dirname(filePath), tempName);
  try {
    await fsAdapter.writeFile(tempPath, contents, 'utf-8');
    await fsAdapter.rename(tempPath, filePath);
  } catch (err) {
    await fsAdapter.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

async function readExistingEvents(
  fsAdapter: TaskTerminalTranscriptFs,
  filePath: string,
): Promise<unknown[]> {
  try {
    const raw = await fsAdapter.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) && Array.isArray(parsed.events) ? parsed.events : [];
  } catch (err) {
    if (getNodeErrorCode(err) === 'ENOENT' || err instanceof SyntaxError) {
      return [];
    }
    throw err;
  }
}

function hasRealTaskId(taskId: string): boolean {
  return taskId.trim() !== '' && taskId !== 'N/A';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
