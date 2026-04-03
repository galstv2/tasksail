import type {
  PlannerEventParseFailure,
  PlannerEventParseResult,
  PlannerEventParseSuccess,
  PlannerNormalizedEvent,
  PlannerRawEvent,
  PlannerTurnFailedEvent,
  PlannerUsage,
} from './plannerSession.types';

type PlannerParseContext = {
  currentTurnId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function extractMessageContent(value: unknown): string | null {
  const direct = readString(value);
  if (direct) {
    return direct;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts = value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      return readString(item.text) ?? readString(item.content);
    })
    .filter((item): item is string => item !== null);

  return parts.length > 0 ? parts.join('') : null;
}

function readUsage(value: unknown): PlannerUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const codeChanges = isRecord(value.codeChanges)
    ? {
        linesAdded: typeof value.codeChanges.linesAdded === 'number' ? value.codeChanges.linesAdded : undefined,
        linesRemoved: typeof value.codeChanges.linesRemoved === 'number' ? value.codeChanges.linesRemoved : undefined,
        filesModified: Array.isArray(value.codeChanges.filesModified)
          ? value.codeChanges.filesModified.filter((item): item is string => typeof item === 'string')
          : undefined,
      }
    : undefined;

  return {
    premiumRequests: typeof value.premiumRequests === 'number' ? value.premiumRequests : undefined,
    totalApiDurationMs: typeof value.totalApiDurationMs === 'number' ? value.totalApiDurationMs : undefined,
    sessionDurationMs: typeof value.sessionDurationMs === 'number' ? value.sessionDurationMs : undefined,
    codeChanges,
  };
}

function createParseFailure(line: string, message: string, turnId: string | null): PlannerEventParseFailure {
  const failedEvent: PlannerTurnFailedEvent = {
    type: 'planner.turn.failed',
    brokerStatus: 'failed',
    turnId,
    rawType: null,
    error: message,
    exitCode: null,
  };

  return {
    kind: 'parse-error',
    classification: 'renderable',
    rawType: null,
    rawEvent: null,
    error: {
      code: 'invalid-jsonl',
      message,
      line,
    },
    events: [failedEvent],
  };
}

function createShapeFailure(line: string, message: string, turnId: string | null): PlannerEventParseFailure {
  const failure = createParseFailure(line, message, turnId);
  return {
    ...failure,
    error: {
      ...failure.error,
      code: 'invalid-event-shape',
    },
  };
}

function createIgnoredResult(rawType: string | null, rawEvent: PlannerRawEvent | null): PlannerEventParseSuccess {
  return {
    kind: 'event',
    classification: 'ignored',
    rawType,
    rawEvent,
    events: [],
  };
}

function createUnknownResult(rawEvent: PlannerRawEvent): PlannerEventParseSuccess {
  return {
    kind: 'event',
    classification: 'unknown',
    rawType: rawEvent.type,
    rawEvent,
    events: [],
  };
}

export function parsePlannerEventLine(
  line: string,
  context: PlannerParseContext = { currentTurnId: null },
): PlannerEventParseResult {
  if (line.trim().length === 0) {
    return createIgnoredResult(null, null);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return createParseFailure(line, 'Malformed planner JSONL line.', context.currentTurnId);
  }

  if (!isRecord(parsed)) {
    return createShapeFailure(line, 'Planner JSONL event must be a JSON object.', context.currentTurnId);
  }

  const rawType = readString(parsed.type);
  if (!rawType) {
    return createShapeFailure(line, 'Planner JSONL event must include a string type field.', context.currentTurnId);
  }

  const rawEvent: PlannerRawEvent = {
    type: rawType,
    data: isRecord(parsed.data) ? parsed.data : undefined,
    timestamp: readString(parsed.timestamp) ?? undefined,
    id: readString(parsed.id) ?? undefined,
    parentId: readString(parsed.parentId) ?? undefined,
    ephemeral: typeof parsed.ephemeral === 'boolean' ? parsed.ephemeral : undefined,
    sessionId: readString(parsed.sessionId) ?? undefined,
    exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : undefined,
    usage: readUsage(parsed.usage) ?? undefined,
  };

  const data = rawEvent.data ?? {};
  const turnId = context.currentTurnId;

  switch (rawType) {
    case 'assistant.turn_start': {
      return {
        kind: 'event',
        classification: 'renderable',
        rawType,
        rawEvent,
        events: [{
          type: 'planner.turn.started',
          brokerStatus: 'running',
          turnId: readString(data.turnId),
          rawType,
          timestamp: rawEvent.timestamp,
        }],
      };
    }
    case 'assistant.message_delta': {
      const content = readString(data.deltaContent);
      if (!content) {
        return createIgnoredResult(rawType, rawEvent);
      }
      return {
        kind: 'event',
        classification: 'renderable',
        rawType,
        rawEvent,
        events: [{
          type: 'planner.turn.message',
          brokerStatus: 'running',
          turnId,
          rawType,
          timestamp: rawEvent.timestamp,
          content,
          messageKind: 'delta',
        }],
      };
    }
    case 'assistant.message': {
      const content = extractMessageContent(data.content);
      if (!content) {
        return createIgnoredResult(rawType, rawEvent);
      }
      return {
        kind: 'event',
        classification: 'renderable',
        rawType,
        rawEvent,
        events: [{
          type: 'planner.turn.message',
          brokerStatus: 'running',
          turnId,
          rawType,
          timestamp: rawEvent.timestamp,
          content,
          messageKind: 'final',
        }],
      };
    }
    case 'assistant.reasoning':
    case 'assistant.turn_end':
    case 'session.mcp_server_status_changed':
    case 'session.mcp_servers_loaded':
    case 'session.tools_updated':
    case 'user.message':
      return createIgnoredResult(rawType, rawEvent);
    case 'result': {
      const events: PlannerNormalizedEvent[] = [];
      const sessionId = rawEvent.sessionId;
      const exitCode = rawEvent.exitCode ?? null;
      const usage = rawEvent.usage ?? null;

      if (sessionId) {
        events.push({
          type: 'planner.session.updated',
          brokerStatus: exitCode === 0 ? 'completed' : 'failed',
          turnId,
          rawType,
          timestamp: rawEvent.timestamp,
          copilotSessionId: sessionId,
        });
      }

      if (exitCode === 0) {
        events.push({
          type: 'planner.turn.completed',
          brokerStatus: 'completed',
          turnId,
          rawType,
          timestamp: rawEvent.timestamp,
          exitCode,
          usage,
        });
      } else {
        events.push({
          type: 'planner.turn.failed',
          brokerStatus: 'failed',
          turnId,
          rawType,
          timestamp: rawEvent.timestamp,
          exitCode,
          error: exitCode === null
            ? 'Planner result event omitted an exit code.'
            : `Planner Copilot process exited with code ${exitCode}.`,
        });
      }

      return {
        kind: 'event',
        classification: 'session-continuity',
        rawType,
        rawEvent,
        events,
      };
    }
    default:
      return createUnknownResult(rawEvent);
  }
}

export class PlannerEventParser {
  private pendingLine = '';

  private currentTurnId: string | null = null;

  parseChunk(chunk: string): PlannerEventParseResult[] {
    const lines = `${this.pendingLine}${chunk}`.split('\n');
    this.pendingLine = lines.pop() ?? '';

    return lines
      .map((line) => line.endsWith('\r') ? line.slice(0, -1) : line)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const result = parsePlannerEventLine(line, { currentTurnId: this.currentTurnId });
        this.updateTurnContext(result);
        return result;
      });
  }

  flush(): PlannerEventParseResult[] {
    const trailingLine = this.pendingLine.endsWith('\r')
      ? this.pendingLine.slice(0, -1)
      : this.pendingLine;
    this.pendingLine = '';

    if (trailingLine.trim().length === 0) {
      return [];
    }

    const result = createParseFailure(
      trailingLine,
      'Planner JSONL stream ended with an incomplete line.',
      this.currentTurnId,
    );
    this.currentTurnId = null;
    return [result];
  }

  private updateTurnContext(result: PlannerEventParseResult): void {
    const startedEvent = result.events.find((event) => event.type === 'planner.turn.started');
    if (startedEvent?.type === 'planner.turn.started') {
      this.currentTurnId = startedEvent.turnId;
      return;
    }

    if ((result.rawType === 'assistant.turn_end' || result.rawType === 'result') && this.currentTurnId) {
      this.currentTurnId = null;
    }
  }
}

