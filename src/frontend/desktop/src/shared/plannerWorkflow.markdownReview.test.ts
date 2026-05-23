import { describe, expect, it } from 'vitest';

import { buildMarkdownReviewPrompt } from './plannerWorkflow';

describe('buildMarkdownReviewPrompt', () => {
  it('treats markdown review as a standard task flow unless the child-task path is active', () => {
    const prompt = buildMarkdownReviewPrompt('standard.md', '# standard_task');

    expect(prompt).toContain('This is the standard planner review path, not an active child-task workflow.');
    expect(prompt).toContain('An empty Parent Task Carry-Forward Summary is valid in this standard flow');
    expect(prompt).toContain('do not ask whether this is a child task');
  });

  it('tells Lily to direct the operator to click Draft Spec when the required sections are complete', () => {
    const prompt = buildMarkdownReviewPrompt('standard.md', '# standard_task');

    expect(prompt).toContain('If you have everything you need to draft the spec');
    expect(prompt).toContain('the intake is ready and the Draft Spec button can be clicked');
  });
});
