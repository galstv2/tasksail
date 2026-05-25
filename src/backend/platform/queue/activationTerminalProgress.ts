import { createLogger, emitTaskProgressEvent, type TaskProgressEvent } from '../core/index.js';

const log = createLogger('platform/queue/activationTerminalProgress');

export async function emitActivationTerminalProgress(args: {
  repoRoot: string;
  taskId: string;
  event: TaskProgressEvent;
}): Promise<void> {
  await emitTaskProgressEvent({
    logger: log.child({ taskId: args.taskId }),
    repoRoot: args.repoRoot,
    taskId: args.taskId,
    event: args.event,
  });
}
