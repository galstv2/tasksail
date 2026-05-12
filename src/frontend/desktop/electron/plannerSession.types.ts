export type PlannerBrokerStatus = 'idle' | 'running' | 'completed' | 'failed';

export type PlannerEventClassification = 'renderable' | 'session-continuity' | 'ignored' | 'unknown';

export type PlannerMessageKind = 'delta' | 'final';

export type PlannerUsage = {
  premiumRequests?: number;
  totalApiDurationMs?: number;
  sessionDurationMs?: number;
  codeChanges?: {
    linesAdded?: number;
    linesRemoved?: number;
    filesModified?: string[];
  };
};

export type PlannerBrokerState = {
  brokerStatus: PlannerBrokerStatus;
  cliSessionId: string | null;
  turnId: string | null;
  content: string;
  exitCode: number | null;
  usage: PlannerUsage | null;
  error: string | null;
};

type PlannerEventBase = {
  type:
    | 'planner.turn.started'
    | 'planner.turn.message'
    | 'planner.turn.completed'
    | 'planner.turn.failed'
    | 'planner.session.updated';
  brokerStatus: PlannerBrokerStatus;
  turnId: string | null;
  rawType: string | null;
  timestamp?: string;
};

export type PlannerTurnStartedEvent = PlannerEventBase & {
  type: 'planner.turn.started';
};

export type PlannerTurnMessageEvent = PlannerEventBase & {
  type: 'planner.turn.message';
  content: string;
  messageKind: PlannerMessageKind;
};

export type PlannerTurnCompletedEvent = PlannerEventBase & {
  type: 'planner.turn.completed';
  exitCode: number;
  usage: PlannerUsage | null;
};

export type PlannerTurnFailedEvent = PlannerEventBase & {
  type: 'planner.turn.failed';
  error: string;
  exitCode: number | null;
};

export type PlannerSessionUpdatedEvent = PlannerEventBase & {
  type: 'planner.session.updated';
  cliSessionId: string;
};

export type PlannerNormalizedEvent =
  | PlannerTurnStartedEvent
  | PlannerTurnMessageEvent
  | PlannerTurnCompletedEvent
  | PlannerTurnFailedEvent
  | PlannerSessionUpdatedEvent;

export type PlannerParseErrorCode = 'invalid-jsonl' | 'invalid-event-shape';

export type PlannerParseError = {
  code: PlannerParseErrorCode;
  message: string;
  line: string;
};

export type PlannerRawEvent = {
  type: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  id?: string;
  parentId?: string;
  ephemeral?: boolean;
  sessionId?: string;
  exitCode?: number;
  usage?: PlannerUsage;
};

export type PlannerEventParseSuccess = {
  kind: 'event';
  classification: PlannerEventClassification;
  rawType: string | null;
  rawEvent: PlannerRawEvent | null;
  events: PlannerNormalizedEvent[];
};

export type PlannerEventParseFailure = {
  kind: 'parse-error';
  classification: 'renderable';
  rawType: null;
  rawEvent: null;
  error: PlannerParseError;
  events: [PlannerTurnFailedEvent];
};

export type PlannerEventParseResult = PlannerEventParseSuccess | PlannerEventParseFailure;

export type PlannerCliInvocation = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  agentId: string;
  model: string;
  prompt: string;
  promptMode: 'interactive' | 'one-shot';
  resumeSessionId: string | null;
  plannerSessionId: string | null;
  allowedRoots: string[];
  contextPackBoundaryEnforced: boolean;
};
