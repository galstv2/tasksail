import { describe, expect, it } from 'vitest';

import { buildChildTaskStarterPrompt } from './plannerWorkflow';

describe('buildChildTaskStarterPrompt intake ownership', () => {
  it('tells Lily to translate the conversation into intake fields instead of asking for a form', () => {
    const prompt = buildChildTaskStarterPrompt({
      parentTaskId: 'TASK-002',
      parentTaskTitle: 'Parent task',
      rootTaskId: 'TASK-001',
      parentQmdScope: 'qmd/context-packs/test-pack',
    });

    expect(prompt).toContain('You own translating the conversation into Request Summary');
    expect(prompt).toContain('Ask natural follow-up questions for missing facts');
    expect(prompt).toContain('Do not ask the Guide to fill section-by-section intake fields');
    expect(prompt).toContain('or present a required-fields form');
    expect(prompt).not.toContain('The Guide will provide or you should ask for');
  });
});
