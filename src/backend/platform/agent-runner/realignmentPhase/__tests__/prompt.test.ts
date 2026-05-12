import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { buildRealignmentPrompt } from '../prompt.js';
import type { RealignmentBundle } from '../bundle.js';

describe('buildRealignmentPrompt', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'realignment-prompt-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('reads the active realignment prompt anchor, renders subsections in order, and appends Ron MCP context', async () => {
    seedPrompt('You are running in realignment mode.');

    const prompt = await buildRealignmentPrompt({
      repoRoot,
      bundle: bundleFixture(),
      externalMcpRegistry: {
        schema_version: 1,
        external_servers: [{
          id: 'docs',
          display_name: 'Docs',
          enabled: true,
          purpose: 'reference checks',
          transport: 'http',
          url: 'https://example.invalid',
          preferred_for: ['realignment analysis'],
          fallback_description: 'continue without it',
          agent_scope: { mode: 'allowlist', agent_ids: ['ron'] },
        }],
      },
    });

    expect(prompt).toContain('You are running in realignment mode.');
    expect(prompt).toContain('Rolling insight content');
    expect(prompt).toContain('Shared memory content');
    expect(prompt).toContain('## External MCP Guidance');
    const orderedHeadings = [
      '### Trigger Feedback',
      '### Trigger Task',
      '### Recent Negative Feedback',
      '### Recent Tasks',
      '### Current Global Realignment Document',
      '### Rolling Retrospective Digest',
      '### Recent Shared Retrospective Memory',
      '### Warnings',
    ];
    expect(orderedHeadings.map((heading) => prompt.indexOf(heading))).toEqual(
      [...orderedHeadings.map((heading) => prompt.indexOf(heading))].sort((a, b) => a - b),
    );
  });

  it('throws when the prompt anchor is missing or empty', async () => {
    await expect(buildRealignmentPrompt({ repoRoot, bundle: bundleFixture() })).rejects.toThrow(
      'Realignment prompt anchor missing or empty:',
    );

    seedPrompt('   ');
    await expect(buildRealignmentPrompt({ repoRoot, bundle: bundleFixture() })).rejects.toThrow(
      'Realignment prompt anchor missing or empty:',
    );
  });

  function seedPrompt(content: string): void {
    const promptPath = path.join(repoRoot, '.github', 'copilot', 'prompts', 'realignment-task.prompt.md');
    mkdirSync(path.dirname(promptPath), { recursive: true });
    writeFileSync(promptPath, content, 'utf-8');
  }
});

function bundleFixture(): RealignmentBundle {
  const task = {
    taskId: 'TASK-1',
    taskTitle: 'Task One',
    taskSummary: 'Summary',
    completedWorkSummary: 'Completed',
    keyDecisions: ['Decision'],
    knownLimitations: ['Limitation'],
    difficultyLevel: 'Medium',
    retrospectiveSummary: 'Retro',
    whatWentWell: ['Well'],
    whatCouldHaveGoneBetter: ['Better'],
    actionItems: ['Action'],
    warnings: [],
  };
  return {
    realignmentId: 'RA-1',
    triggerFeedback: {
      feedbackId: 'FB-1',
      taskId: 'TASK-1',
      feedbackType: 'negative',
      starRating: 2,
      comment: 'Trigger comment',
      createdAt: '2026-01-01T00:00:00Z',
    },
    triggerTask: task,
    recentNegativeFeedback: [],
    recentTasks: [task],
    globalRealignmentDoc: {
      standingExpectations: ['Expectation'],
      lessonsLearned: ['Lesson'],
      behavioralGuidance: ['Guidance'],
      fairnessFraming: ['Fairness'],
      version: 1,
    },
    rollingRetrospectives: [{
      taskId: 'TASK-2',
      taskTitle: 'Task Two',
      completedAt: '2026-01-02T00:00:00Z',
      retrospectiveSummary: 'Rolling insight content',
      whatWentWell: ['Well'],
      whatCouldHaveGoneBetter: ['Better'],
      actionItems: ['Action'],
      warnings: [],
    }],
    sharedRetrospectiveMemory: 'Shared memory content',
    warnings: ['Recoverable warning'],
  };
}
