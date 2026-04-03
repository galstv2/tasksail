import { describe, expect, it } from 'vitest';

import type {
  ReinforcementRealignmentSessionEntry,
  ReinforcementTaskEntry,
} from '../../shared/desktopContract';
import { filterSessionsForTasks, selectScopedSession } from './reinforcementSessionFilter';

function makeTask(taskId: string): ReinforcementTaskEntry {
  return {
    taskId,
    title: taskId,
    difficulty: 'medium',
    effectiveReward: 2000,
    settlementStatus: 'unrewarded',
    qualityOutcome: 'success',
    year: '2026',
  };
}

function makeSession(
  realignmentId: string,
  triggerTaskId: string,
): ReinforcementRealignmentSessionEntry {
  return {
    realignmentId,
    triggerTaskId,
    triggerFeedbackId: `FB-${realignmentId}`,
    participatingAgents: ['software-engineer'],
    failureAnalysis: '',
    rootCause: '',
    correctiveActions: [],
    status: 'open',
    meetingNotes: '',
    createdAt: '2026-03-22T00:00:00Z',
  };
}

describe('filterSessionsForTasks', () => {
  it('returns only sessions whose triggerTaskId is in the task list', () => {
    const tasks = [makeTask('T-1'), makeTask('T-2')];
    const sessions = [
      makeSession('RA-1', 'T-1'),
      makeSession('RA-2', 'T-3'),
      makeSession('RA-3', 'T-2'),
    ];

    const result = filterSessionsForTasks(sessions, tasks);

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.realignmentId)).toEqual(['RA-1', 'RA-3']);
  });

  it('returns empty array when no sessions match', () => {
    const tasks = [makeTask('T-1')];
    const sessions = [makeSession('RA-1', 'T-99')];

    expect(filterSessionsForTasks(sessions, tasks)).toEqual([]);
  });

  it('returns empty array when tasks list is empty', () => {
    const sessions = [makeSession('RA-1', 'T-1')];

    expect(filterSessionsForTasks(sessions, [])).toEqual([]);
  });

  it('returns empty array when sessions list is empty', () => {
    const tasks = [makeTask('T-1')];

    expect(filterSessionsForTasks([], tasks)).toEqual([]);
  });
});

describe('selectScopedSession', () => {
  it('returns the matching session when it exists in the filtered list', () => {
    const filtered = [makeSession('RA-1', 'T-1'), makeSession('RA-2', 'T-2')];

    const result = selectScopedSession(filtered, 'RA-2');

    expect(result?.realignmentId).toBe('RA-2');
  });

  it('returns null when the selected session is not in the filtered list', () => {
    const filtered = [makeSession('RA-1', 'T-1')];

    expect(selectScopedSession(filtered, 'RA-99')).toBeNull();
  });

  it('returns null when selectedSessionId is null', () => {
    const filtered = [makeSession('RA-1', 'T-1')];

    expect(selectScopedSession(filtered, null)).toBeNull();
  });

  it('returns null when filtered list is empty', () => {
    expect(selectScopedSession([], 'RA-1')).toBeNull();
  });
});
