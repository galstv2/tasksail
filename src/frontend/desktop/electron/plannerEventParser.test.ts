// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { PlannerEventParser } from './plannerEventParser';

describe('PlannerEventParser provider parser', () => {
  it('parses assistant.message into a normalized planner message event', () => {
    const parser = new PlannerEventParser();
    parser.parseChunk('{"type":"assistant.turn_start","data":{"turnId":"turn-7"}}\n');
    const [result] = parser.parseChunk(
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-03-19T16:19:14.246Z',
        data: {
          content: 'READY',
        },
      }) + '\n',
    );

    expect(result.kind).toBe('event');
    expect(result.classification).toBe('renderable');
    expect(result.events).toEqual([
      {
        type: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'turn-7',
        rawType: 'assistant.message',
        timestamp: '2026-03-19T16:19:14.246Z',
        content: 'READY',
        messageKind: 'final',
      },
    ]);
  });

  it('parses result and extracts session continuity data', () => {
    const parser = new PlannerEventParser();
    parser.parseChunk('{"type":"assistant.turn_start","data":{"turnId":"turn-7"}}\n');
    const [result] = parser.parseChunk(
      JSON.stringify({
        type: 'result',
        timestamp: '2026-03-19T16:19:14.248Z',
        sessionId: '0773f9ef-0pm5-4pmd-8fe4-728fa5fa74be',
        exitCode: 0,
        usage: {
          premiumRequests: 1,
          totalApiDurationMs: 5956,
          sessionDurationMs: 10970,
          codeChanges: {
            linesAdded: 0,
            linesRemoved: 0,
            filesModified: [],
          },
        },
      }) + '\n',
    );

    expect(result.kind).toBe('event');
    expect(result.classification).toBe('session-continuity');
    expect(result.events).toEqual([
      {
        type: 'planner.session.updated',
        brokerStatus: 'completed',
        turnId: 'turn-7',
        rawType: 'result',
        timestamp: '2026-03-19T16:19:14.248Z',
        cliSessionId: '0773f9ef-0pm5-4pmd-8fe4-728fa5fa74be',
      },
      {
        type: 'planner.turn.completed',
        brokerStatus: 'completed',
        turnId: 'turn-7',
        rawType: 'result',
        timestamp: '2026-03-19T16:19:14.248Z',
        exitCode: 0,
        usage: {
          premiumRequests: 1,
          totalApiDurationMs: 5956,
          sessionDurationMs: 10970,
          codeChanges: {
            linesAdded: 0,
            linesRemoved: 0,
            filesModified: [],
          },
        },
      },
    ]);
  });

  it('ignores non-renderable reasoning events', () => {
    const parser = new PlannerEventParser();
    const [result] = parser.parseChunk(
      JSON.stringify({
        type: 'assistant.reasoning',
        data: {
          content: 'internal',
        },
      }) + '\n',
    );

    expect(result.kind).toBe('event');
    expect(result.classification).toBe('ignored');
    expect(result.events).toEqual([]);
  });

  it('preserves additive compatibility for unknown event types', () => {
    const parser = new PlannerEventParser();
    const [result] = parser.parseChunk(
      JSON.stringify({
        type: 'session.future_event',
        data: {
          featureFlag: true,
        },
      }) + '\n',
    );

    expect(result.kind).toBe('event');
    expect(result.classification).toBe('unknown');
    expect(result.rawType).toBe('session.future_event');
    expect(result.events).toEqual([]);
  });

  it('surfaces malformed JSONL lines as explicit parser failures', () => {
    const parser = new PlannerEventParser();
    parser.parseChunk('{"type":"assistant.turn_start","data":{"turnId":"turn-7"}}\n');
    const [result] = parser.parseChunk('{"type":"assistant.message"\n');

    expect(result.kind).toBe('parse-error');
    if (result.kind !== 'parse-error') {
      throw new Error('Expected parse-error result.');
    }
    expect(result.error.code).toBe('invalid-jsonl');
    expect(result.events).toEqual([
      {
        type: 'planner.turn.failed',
        brokerStatus: 'failed',
        turnId: 'turn-7',
        rawType: null,
        error: 'Malformed planner JSONL line.',
        exitCode: null,
      },
    ]);
  });
});

describe('PlannerEventParser', () => {
  it('parses fixture JSONL streams into normalized planner event sequences', () => {
    const parser = new PlannerEventParser();

    const results = parser.parseChunk(
      [
        JSON.stringify({
          type: 'assistant.turn_start',
          data: { turnId: 'turn-9' },
        }),
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'Hel' },
        }),
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'Hello' },
        }),
        JSON.stringify({
          type: 'result',
          sessionId: 'session-9',
          exitCode: 0,
        }),
      ].join('\n') + '\n',
    );

    expect(results.flatMap((result) => result.events)).toEqual([
      {
        type: 'planner.turn.started',
        brokerStatus: 'running',
        turnId: 'turn-9',
        rawType: 'assistant.turn_start',
      },
      {
        type: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'turn-9',
        rawType: 'assistant.message_delta',
        content: 'Hel',
        messageKind: 'delta',
      },
      {
        type: 'planner.turn.message',
        brokerStatus: 'running',
        turnId: 'turn-9',
        rawType: 'assistant.message',
        content: 'Hello',
        messageKind: 'final',
      },
      {
        type: 'planner.session.updated',
        brokerStatus: 'completed',
        turnId: 'turn-9',
        rawType: 'result',
        cliSessionId: 'session-9',
      },
      {
        type: 'planner.turn.completed',
        brokerStatus: 'completed',
        turnId: 'turn-9',
        rawType: 'result',
        exitCode: 0,
        usage: null,
      },
    ]);
  });

  it('reports an incomplete trailing line when the JSONL stream flushes', () => {
    const parser = new PlannerEventParser();

    parser.parseChunk('{"type":"assistant.turn_start","data":{"turnId":"turn-3"}}\n');
    parser.parseChunk('{"type":"assistant.message"');

    expect(parser.flush()).toEqual([
      {
        kind: 'parse-error',
        classification: 'renderable',
        rawType: null,
        rawEvent: null,
        error: {
          code: 'invalid-jsonl',
          message: 'Planner JSONL stream ended with an incomplete line.',
          line: '{"type":"assistant.message"',
        },
        events: [
          {
            type: 'planner.turn.failed',
            brokerStatus: 'failed',
            turnId: 'turn-3',
            rawType: null,
            error: 'Planner JSONL stream ended with an incomplete line.',
            exitCode: null,
          },
        ],
      },
    ]);
  });
});
