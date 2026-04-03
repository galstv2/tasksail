import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

describe('validateDesktopActionRequest — reinforcement actions', () => {
  describe('reinforcement.submitFeedback', () => {
    it('accepts a valid payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/context-pack',
          taskId: 'TASK-001',
          feedbackType: 'positive',
        },
      });
      expect(errors).toEqual([]);
    });

    it('accepts optional starRating and comment', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/context-pack',
          taskId: 'TASK-001',
          feedbackType: 'negative',
          starRating: 2,
          comment: 'Needs improvement',
        },
      });
      expect(errors).toEqual([]);
    });

    it('rejects missing payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
      });
      expect(errors).toEqual(['payload must be an object.']);
    });

    it('rejects relative contextPackDir', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: 'relative/path',
          taskId: 'TASK-001',
          feedbackType: 'positive',
        },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
    });

    it('rejects empty taskId', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/cp',
          taskId: '',
          feedbackType: 'positive',
        },
      });
      expect(errors).toContainEqual('payload.taskId must be a non-empty string.');
    });

    it('rejects invalid feedbackType', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/cp',
          taskId: 'TASK-001',
          feedbackType: 'invalid',
        },
      });
      expect(errors).toContainEqual('payload.feedbackType must be none, positive, or negative.');
    });

    it('rejects non-number starRating', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/cp',
          taskId: 'TASK-001',
          feedbackType: 'positive',
          starRating: 'five',
        },
      });
      expect(errors).toContainEqual('payload.starRating must be a number when provided.');
    });

    it('rejects non-string comment', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.submitFeedback',
        payload: {
          contextPackDir: '/tmp/cp',
          taskId: 'TASK-001',
          feedbackType: 'positive',
          comment: 123,
        },
      });
      expect(errors).toContainEqual('payload.comment must be a string when provided.');
    });
  });

  describe('reinforcement.updateRealignmentDoc', () => {
    it('accepts field/value mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          field: 'velocity',
          value: 'high',
        },
      });
      expect(errors).toEqual([]);
    });

    it('accepts bulk updates mode', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          updates: { velocity: 'high' },
        },
      });
      expect(errors).toEqual([]);
    });

    it('rejects missing payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
      });
      expect(errors).toEqual(['payload must be an object.']);
    });

    it('rejects relative contextPackDir', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: 'relative',
          field: 'velocity',
          value: 'high',
        },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
    });

    it('rejects payload with neither field/value nor updates', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
        },
      });
      expect(errors).toContainEqual('payload must include either field/value or updates.');
    });

    it('rejects field without value', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.updateRealignmentDoc',
        payload: {
          contextPackDir: '/tmp/context-pack',
          field: 'velocity',
        },
      });
      expect(errors).toContainEqual('payload.value must be a string when using field/value mode.');
    });
  });

  describe('reinforcement read-side actions', () => {
    it('accepts reinforcement.readOverview without payload', () => {
      expect(validateDesktopActionRequest({ action: 'reinforcement.readOverview' })).toEqual([]);
    });

    it('accepts reinforcement.readAgentRewards without payload', () => {
      expect(validateDesktopActionRequest({ action: 'reinforcement.readAgentRewards' })).toEqual([]);
    });

    it('accepts reinforcement.listRealignmentSessions without payload', () => {
      expect(validateDesktopActionRequest({ action: 'reinforcement.listRealignmentSessions' })).toEqual([]);
    });

    it('accepts reinforcement.readRealignmentDoc without payload', () => {
      expect(validateDesktopActionRequest({ action: 'reinforcement.readRealignmentDoc' })).toEqual([]);
    });

    it('accepts reinforcement.listTasks without payload', () => {
      expect(validateDesktopActionRequest({ action: 'reinforcement.listTasks' })).toEqual([]);
    });

    it('accepts reinforcement.listTasks with year filter', () => {
      expect(validateDesktopActionRequest({
        action: 'reinforcement.listTasks',
        payload: { year: '2026' },
      })).toEqual([]);
    });

    it('rejects reinforcement.listTasks with empty year', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.listTasks',
        payload: { year: '' },
      });
      expect(errors).toContainEqual('payload.year must be a non-empty string when provided.');
    });

    it('rejects reinforcement.listTasks with non-object payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.listTasks',
        payload: 'pmd',
      });
      expect(errors).toContainEqual('payload must be an object when provided.');
    });
  });

  describe('reinforcement.checkActiveWorkGuard', () => {
    it('accepts action without payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.checkActiveWorkGuard',
      });
      expect(errors).toEqual([]);
    });
  });

  describe('reinforcement.startRealignment', () => {
    it('accepts valid payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.startRealignment',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          triggerTaskId: 'T-1',
        },
      });
      expect(errors).toEqual([]);
    });

    it('rejects missing payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.startRealignment',
      });
      expect(errors).toEqual(['payload must be an object.']);
    });

    it('rejects relative contextPackDir', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.startRealignment',
        payload: {
          contextPackDir: 'relative/path',
          triggerTaskId: 'T-1',
        },
      });
      expect(errors).toContainEqual('payload.contextPackDir must be an absolute path string.');
    });

    it('rejects empty triggerTaskId', () => {
      const errors = validateDesktopActionRequest({
        action: 'reinforcement.startRealignment',
        payload: {
          contextPackDir: '/tmp/context-packs/orders-estate',
          triggerTaskId: '',
        },
      });
      expect(errors).toContainEqual('payload.triggerTaskId must be a non-empty string.');
    });
  });
});
