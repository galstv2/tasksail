import type { ChildProcess } from 'node:child_process';

import type { GenericAgentEnv } from '../../../backend/platform/cli-provider/types.js';
import { PlannerEventParser } from './plannerEventParser';
import {
  spawnPlannerCliProcess,
  type BuildPlannerCliInvocationOptions,
} from './plannerCliProcess';
import type {
  PlannerBrokerObservation,
  PlannerBrokerTurnSource,
  PlannerStreamEvent,
} from '../src/shared/desktopContract';
import type {
  PlannerBrokerState,
  PlannerNormalizedEvent,
} from './plannerSession.types';

const KILL_GRACE_MS = 5000;

function isWindowsPlatform(): boolean {
  return process.platform === 'win32';
}

export type PlannerSendResult = 'sent' | 'no-session' | 'busy';

type PlannerEventEmitter = (event: PlannerStreamEvent) => void;

type PlannerCliSpawner = (
  options: BuildPlannerCliInvocationOptions,
) => ChildProcess;

type PlannerSessionRecord = {
  sessionId: string;
  state: PlannerBrokerState;
  activeProcess: ChildProcess | null;
  activeTurnPromise: Promise<void> | null;
  endingSession: boolean;
  bootstrapConsumed: boolean;
  pendingTurns: PendingTurn[];
  contextPackDir: string | null;
  contextPackRoots: string[] | null;
  workingDirectory: string | null;
  focusEnv: Omit<GenericAgentEnv, 'model' | 'agentId'> | null;
};

type PendingTurn = {
  text: string;
};

type PlannerSessionBrokerDependencies = {
  emitEvent?: PlannerEventEmitter;
  spawnCliProcess?: PlannerCliSpawner;
  now?: () => number;
};

function createPlannerBrokerState(): PlannerBrokerState {
  return {
    brokerStatus: 'idle',
    cliSessionId: null,
    turnId: null,
    content: '',
    exitCode: null,
    usage: null,
    error: null,
  };
}

function createPlannerBrokerObservation(): PlannerBrokerObservation {
  return {
    sessionId: null,
    brokerStatus: 'idle',
    activeTurnId: null,
    queuedTurnCount: 0,
    cliSessionId: null,
    lastTurnSource: 'none',
    lastTurnOutcome: 'idle',
    lastTurnAt: null,
    lastTurnHadContent: false,
    lastExitCode: null,
    turnCount: 0,
    error: null,
  };
}

export class PlannerSessionBroker {
  private readonly emitEvent: PlannerEventEmitter;

  private readonly spawnCliProcess: PlannerCliSpawner;

  private readonly now: () => number;

  private session: PlannerSessionRecord | null = null;

  private observation: PlannerBrokerObservation = createPlannerBrokerObservation();

  constructor(dependencies: PlannerSessionBrokerDependencies = {}) {
    this.emitEvent = dependencies.emitEvent ?? (() => undefined);
    this.spawnCliProcess = dependencies.spawnCliProcess ?? spawnPlannerCliProcess;
    this.now = dependencies.now ?? Date.now;
  }

  startSession(options?: {
    contextPackDir?: string;
    allowedRoots?: string[];
    workingDirectory?: string;
    focusEnv?: Omit<GenericAgentEnv, 'model' | 'agentId'>;
  }): { sessionId: string; created: boolean } {
    if (this.session && this.session.state.brokerStatus !== 'failed') {
      this.session.endingSession = false;
      this.observation = {
        ...this.observation,
        sessionId: this.session.sessionId,
        brokerStatus: this.session.state.brokerStatus,
        activeTurnId: this.session.state.turnId,
        queuedTurnCount: this.session.pendingTurns.length,
        cliSessionId: this.session.state.cliSessionId,
        error: this.session.state.error,
      };
      return { sessionId: this.session.sessionId, created: false };
    }

    const sessionId = `planner-${this.now()}`;
    this.session = {
      sessionId,
      state: createPlannerBrokerState(),
      activeProcess: null,
      activeTurnPromise: null,
      endingSession: false,
      bootstrapConsumed: false,
      pendingTurns: [],
      contextPackDir: options?.contextPackDir ?? null,
      contextPackRoots: options?.allowedRoots ?? null,
      workingDirectory: options?.workingDirectory ?? null,
      // Captured once at session start; planner sessions are stable scopes.
      focusEnv: options?.focusEnv ?? null,
    };
    this.observation = {
      ...createPlannerBrokerObservation(),
      sessionId,
    };
    return { sessionId, created: true };
  }

  async sendMessage(text: string): Promise<PlannerSendResult> {
    const session = this.session;
    if (!session) {
      return 'no-session';
    }

    session.pendingTurns.push({ text });
    this.observation = {
      ...this.observation,
      sessionId: session.sessionId,
      queuedTurnCount: session.pendingTurns.length,
    };
    this.ensureTurnProcessing(session);
    return 'sent';
  }

  async saveDraft(instruction: string): Promise<PlannerSendResult> {
    return this.sendMessage(instruction);
  }

  endSession(): void {
    const session = this.session;
    if (!session) {
      return;
    }

    session.endingSession = true;
    const child = session.activeProcess;
    session.pendingTurns.length = 0;
    this.session = null;
    this.observation = {
      ...this.observation,
      sessionId: null,
      brokerStatus: 'idle',
      activeTurnId: null,
      queuedTurnCount: 0,
      cliSessionId: null,
    };

    if (!child) {
      return;
    }

    if (isWindowsPlatform()) {
      // On Windows, SIGTERM and SIGKILL both map to TerminateProcess — the
      // graceful-to-hard escalation collapses to a single hard kill.
      child.kill();
    } else {
      child.kill('SIGTERM');
      const forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, KILL_GRACE_MS);

      child.once('exit', () => {
        clearTimeout(forceKillTimer);
      });
    }
  }

  isSessionActive(): boolean {
    return this.session !== null;
  }

  getState(): PlannerBrokerState | null {
    if (!this.session) {
      return null;
    }

    return {
      ...this.session.state,
      usage: this.session.state.usage
        ? {
            ...this.session.state.usage,
            codeChanges: this.session.state.usage.codeChanges
              ? {
                  ...this.session.state.usage.codeChanges,
                  filesModified: this.session.state.usage.codeChanges.filesModified
                    ? [...this.session.state.usage.codeChanges.filesModified]
                    : undefined,
                }
              : undefined,
          }
        : null,
    };
  }

  getObservability(): PlannerBrokerObservation {
    return { ...this.observation };
  }

  private emitSessionEvent(
    session: PlannerSessionRecord,
    event: Omit<PlannerStreamEvent, 'sessionId'>,
  ): void {
    if (this.session !== session || session.endingSession) {
      return;
    }
    this.emitEvent({
      ...event,
      sessionId: session.sessionId,
    });
  }

  private ensureTurnProcessing(session: PlannerSessionRecord): void {
    if (session.activeTurnPromise) {
      return;
    }

    const turnPromise = this.processQueuedTurns(session);
    session.activeTurnPromise = turnPromise;

    void turnPromise.finally(() => {
      if (session.activeTurnPromise === turnPromise) {
        session.activeTurnPromise = null;
      }
      if (session.activeProcess && session.endingSession) {
        session.activeProcess = null;
      }
    });
  }

  private async processQueuedTurns(session: PlannerSessionRecord): Promise<void> {
    while (this.session === session && !session.endingSession) {
      const pendingTurn = session.pendingTurns.shift();
      if (!pendingTurn) {
        return;
      }
      this.observation = {
        ...this.observation,
        sessionId: session.sessionId,
        queuedTurnCount: session.pendingTurns.length,
      };

      await this.runTurn(session, pendingTurn.text);
    }
  }

  private async runTurn(session: PlannerSessionRecord, text: string): Promise<boolean> {
    const parser = new PlannerEventParser();
    const turnId = `turn-${this.now()}`;
    const resumeSessionId = session.state.cliSessionId;
    const promptMode = !resumeSessionId && !session.bootstrapConsumed ? 'interactive' : 'one-shot';
    const turnSource: PlannerBrokerTurnSource = resumeSessionId
      ? 'resumed-session'
      : promptMode === 'interactive'
        ? 'interactive-bootstrap'
        : 'new-session';
    session.bootstrapConsumed = true;

    session.state.brokerStatus = 'running';
    session.state.turnId = turnId;
    session.state.content = '';
    session.state.exitCode = null;
    session.state.usage = null;
    session.state.error = null;

    const child = this.spawnCliProcess({
      prompt: text,
      promptMode,
      resumeSessionId,
      plannerSessionId: session.sessionId,
      allowedRoots: session.contextPackRoots ?? undefined,
      workingDirectory: session.workingDirectory ?? undefined,
      contextPackBoundaryEnforced: session.contextPackRoots !== null,
      additionalEnv: session.contextPackDir ? { ACTIVE_CONTEXT_PACK_DIR: session.contextPackDir } : undefined,
      focusEnv: session.focusEnv ?? undefined,
    });
    session.activeProcess = child;
    this.observation = {
      ...this.observation,
      sessionId: session.sessionId,
      brokerStatus: 'running',
      activeTurnId: turnId,
      queuedTurnCount: session.pendingTurns.length,
      cliSessionId: session.state.cliSessionId,
      lastTurnSource: turnSource,
      lastTurnOutcome: 'running',
      lastTurnAt: null,
      lastTurnHadContent: false,
      lastExitCode: null,
      turnCount: this.observation.turnCount + 1,
      error: null,
    };

    let sawResultEvent = false;
    let settled = false;
    let emittedFailure = false;
    let observedContent = false;
    const stderrChunks: string[] = [];

    return new Promise<boolean>((resolve) => {
      const settle = (aborted = false): void => {
        if (settled) {
          return;
        }
        settled = true;
        session.activeProcess = null;
        resolve(aborted);
      };

      const emitFailure = (message: string): void => {
        if (emittedFailure) {
          return;
        }
        emittedFailure = true;
        if (resumeSessionId) {
          session.state.cliSessionId = null;
        }
        session.state.brokerStatus = 'failed';
        session.state.error = message;
        this.observation = {
          ...this.observation,
          sessionId: session.sessionId,
          brokerStatus: 'failed',
          activeTurnId: null,
          queuedTurnCount: session.pendingTurns.length,
          cliSessionId: session.state.cliSessionId,
          lastTurnSource: turnSource,
          lastTurnOutcome: 'failed',
          lastTurnAt: new Date().toISOString(),
          lastTurnHadContent: observedContent,
          lastExitCode: session.state.exitCode,
          error: message,
        };
        this.emitSessionEvent(session, {
          eventType: 'planner.turn.failed',
          brokerStatus: session.state.brokerStatus,
          turnId: session.state.turnId,
          done: true,
          content: undefined,
          error: message,
        });
      };

      const applyEvent = (event: PlannerNormalizedEvent): void => {
        switch (event.type) {
          case 'planner.turn.started':
            session.state.brokerStatus = 'running';
            return;
          case 'planner.turn.message':
            session.state.brokerStatus = 'running';
            observedContent = true;
            if (event.messageKind === 'delta') {
              session.state.content += event.content;
            } else {
              session.state.content = event.content;
            }
            this.observation = {
              ...this.observation,
              lastTurnHadContent: true,
            };
        this.emitSessionEvent(session, {
              eventType: event.type,
              brokerStatus: session.state.brokerStatus,
              turnId: session.state.turnId,
              done: false,
              content: event.content,
              messageKind: event.messageKind,
              error: null,
            });
            return;
          case 'planner.session.updated':
            session.state.cliSessionId = event.cliSessionId;
            this.observation = {
              ...this.observation,
              cliSessionId: event.cliSessionId,
            };
            this.emitSessionEvent(session, {
              eventType: event.type,
              brokerStatus: session.state.brokerStatus,
              turnId: session.state.turnId,
              done: false,
              error: null,
              cliSessionId: event.cliSessionId,
            });
            return;
          case 'planner.turn.completed':
            session.state.brokerStatus = 'completed';
            session.state.exitCode = event.exitCode;
            session.state.usage = event.usage;
            this.observation = {
              ...this.observation,
              sessionId: session.sessionId,
              brokerStatus: 'completed',
              activeTurnId: null,
              queuedTurnCount: session.pendingTurns.length,
              cliSessionId: session.state.cliSessionId,
              lastTurnSource: turnSource,
              lastTurnOutcome: 'completed',
              lastTurnAt: new Date().toISOString(),
              lastTurnHadContent: observedContent,
              lastExitCode: event.exitCode,
              error: null,
            };
            this.emitSessionEvent(session, {
              eventType: event.type,
              brokerStatus: session.state.brokerStatus,
              turnId: session.state.turnId,
              done: true,
              error: null,
              cliSessionId: session.state.cliSessionId,
            });
            return;
          case 'planner.turn.failed':
            session.state.brokerStatus = 'failed';
            session.state.exitCode = event.exitCode;
            session.state.error = event.error;
            emitFailure(event.error);
            return;
        }
      };

      this.emitSessionEvent(session, {
        eventType: 'planner.turn.started',
        brokerStatus: 'running',
        turnId: session.state.turnId,
        done: false,
        error: null,
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        if (session.endingSession || settled) {
          return;
        }
        for (const result of parser.parseChunk(chunk.toString('utf-8'))) {
          if (result.rawType === 'result') {
            sawResultEvent = true;
          }
          for (const event of result.events) {
            applyEvent(event);
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (session.endingSession || settled) {
          return;
        }
        const textChunk = chunk.toString('utf-8').trim();
        if (textChunk.length > 0) {
          stderrChunks.push(textChunk);
        }
      });

      child.once('error', (error) => {
        if (settled) {
          return;
        }
        if (session.endingSession) {
          settle(true);
          return;
        }
        emitFailure(`Failed to start planner agent CLI process: ${error.message}`);
        settle(false);
      });

      child.once('exit', (exitCode) => {
        if (settled) {
          return;
        }
        if (session.endingSession) {
          settle(true);
          return;
        }

        for (const result of parser.flush()) {
          for (const event of result.events) {
            applyEvent(event);
          }
        }

        if (!sawResultEvent && session.state.brokerStatus !== 'failed') {
          const stderrDetail = stderrChunks.join('\n');
          const pmseMessage = exitCode === 0
            ? 'Planner agent CLI process ended without a result event.'
            : `Planner agent CLI process exited with code ${exitCode ?? 'unknown'}.`;
          const failureMessage = stderrDetail ? `${pmseMessage} ${stderrDetail}` : pmseMessage;
          session.state.exitCode = exitCode ?? null;
          emitFailure(failureMessage);
        }
        settle(false);
      });
    });
  }
}
