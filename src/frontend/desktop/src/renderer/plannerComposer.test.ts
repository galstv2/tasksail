import { describe, expect, it } from 'vitest';

import { createFollowUpDraft, createLocalDraft, formatDraftMarkdown, normalizeArchivedTaskToFollowUpContext } from './plannerComposer';

describe('plannerComposer helpers', () => {
  it('creates a local draft model aligned to the helper-script contract', () => {
    const draft = createLocalDraft(
      {
        title: 'Prototype local queue draft',
        summary: 'Prepare a markdown draft in the renderer.',
        desiredOutcome: 'Operators can review the shape before submission exists.',
        constraints: ['Stay local only', 'Do not call helper scripts'],
        acceptanceSignals: ['Preview renders markdown', 'Confirm remains local'],
        planningNotes: 'Later slices can map this to helper flags.',
        suggestedPath: 'sequential',
      },
    );

    expect(draft).toMatchObject({
      title: 'Prototype local queue draft',
      taskKind: 'standard',
      parentTaskId: '',
      suggestedPath: 'sequential',
    });
    expect(draft.constraints).toContain('Stay local only');
    expect(draft.acceptanceSignals).toContain('Confirm remains local');
  });

  it('formats queue-ready markdown sections in helper-script order', () => {
    const markdown = formatDraftMarkdown(
      createLocalDraft(
        {
          title: 'Prototype local queue draft',
          summary: 'Prepare a markdown draft in the renderer.',
          desiredOutcome: 'Operators can review the shape before submission exists.',
          constraints: ['Stay local only', 'Do not call helper scripts'],
          acceptanceSignals: ['Preview renders markdown', 'Confirm remains local'],
          planningNotes: 'Later slices can map this to helper flags.',
          suggestedPath: 'sequential',
        },
      ),
    );

    expect(markdown).toContain('# Prototype local queue draft');
    expect(markdown).toContain('## Task Lineage');
    expect(markdown).toContain('## Request Summary');
    expect(markdown).toContain('## Desired Outcome');
    expect(markdown).toContain('## Constraints');
    expect(markdown).toContain('## Acceptance Signals');
    expect(markdown).toContain('## Suggested Routing');
    expect(markdown).toContain('- Recommended Execution: sequential');
    expect(markdown).toContain('- Created By: Lily (Planning Specialist)');
  });

  it('prefills a child-task draft with completed-task lineage for follow-up composition', () => {
    const draft = createFollowUpDraft(
      {
        parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
        parentTaskTitle: 'Package renderer layout findings for handoff',
        parentQmdRecordId: 'qmd://implementation-summary/CAP-CUSTOM-TERMINAL-08/final',
        parentQmdScope: 'qmd/context-packs/test-pack',
        rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
        followupReason: 'Carry completed renderer findings into the next child-task slice.',
        carryForwardSummary: 'Preserve the read-only console lock during follow-up composition.',
        childTitle: 'Create child-task intake for live follow-up integration',
        requestedAdjustment: 'Start a child-task planning flow from completed renderer findings.',
        desiredOutcome: 'A new child task is created without reopening the parent task.',
        constraints: ['Keep the parent task read-only.'],
        acceptanceSignals: ['Child-task draft preserves lineage.'],
        planningNotes: 'Parent Final Summary Reference: qmd/context-packs/test-pack.md',
        suggestedPath: 'sequential',
      },
    );

    expect(draft).toMatchObject({
      title: 'Create child-task intake for live follow-up integration',
      taskKind: 'child-task',
      parentTaskId: 'CAP-CUSTOM-TERMINAL-08',
      rootTaskId: 'CAP-CUSTOM-TERMINAL-01',
      followupReason: 'Carry completed renderer findings into the next child-task slice.',
    });

    const markdown = formatDraftMarkdown(draft);
    expect(markdown).toContain('- Task Kind: child-task');
    expect(markdown).toContain('- Parent Task ID: CAP-CUSTOM-TERMINAL-08');
    expect(markdown).toContain('- Follow-Up Reason: Carry completed renderer findings into the next child-task slice.');
    expect(markdown).toContain('## Parent Task Carry-Forward Summary');
  });

  it('normalizes an ArchivedTaskEntry into FollowUpDraftContext with correct lineage', () => {
    const context = normalizeArchivedTaskToFollowUpContext({
      taskId: '20260318T065634Z-add-search-and-stats',
      title: 'Add search and stats modules',
      summary: '',
      rootTaskId: '',
      qmdRecordId: '',
      followupReason: '',
      year: '2026',
      archivePath: '/archive/2026/task.md',
      contextPackName: 'live-test-context-pack',
    });

    expect(context.parentTaskId).toBe('20260318T065634Z-add-search-and-stats');
    expect(context.parentTaskTitle).toBe('Add search and stats modules');
    expect(context.rootTaskId).toBe('20260318T065634Z-add-search-and-stats');
    expect(context.parentQmdScope).toBe('qmd/context-packs/live-test-context-pack');
    expect(context.followupReason).toBe('');
    expect(context.carryForwardSummary).toBe('');
    expect(context.childTitle).toBe('');
    expect(context.suggestedPath).toBe('sequential');
  });

  it('normalizeArchivedTaskToFollowUpContext produces a valid child-task draft via createFollowUpDraft', () => {
    const context = normalizeArchivedTaskToFollowUpContext({
      taskId: 'TASK-001',
      title: 'Completed parent task',
      summary: '',
      rootTaskId: '',
      qmdRecordId: '',
      followupReason: '',
      year: '2026',
      archivePath: '/archive/2026/task.md',
      contextPackName: 'test-pack',
    });
    const draft = createFollowUpDraft(context);

    expect(draft.taskKind).toBe('child-task');
    expect(draft.parentTaskId).toBe('TASK-001');
    expect(draft.rootTaskId).toBe('TASK-001');
    expect(draft.parentQmdScope).toBe('qmd/context-packs/test-pack');
    expect(draft.title).toBe('');
    expect(draft.summary).toBe('');
  });
});
