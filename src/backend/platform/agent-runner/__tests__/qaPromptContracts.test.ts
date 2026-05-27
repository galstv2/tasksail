import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('Ron prompt contracts', () => {
  it('tells Ron normal QA launches are non-interactive and artifact-complete', () => {
    const instructions = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'instructions', 'qa.instructions.md'),
      'utf-8',
    );

    expect(instructions).toContain('## Non-Interactive Launch Contract');
    expect(instructions).toContain('## QA Artifact Checklist');
    expect(instructions).toContain('launch-specific source of truth for concrete artifact paths');
    expect(instructions).toContain('You will not receive follow-up input');
    expect(instructions).toContain('Do not stop after reading the diff, checking validation evidence, deciding a verdict, or writing a prose QA summary');
    expect(instructions).toContain('Your chat response is not workflow completion');
    expect(instructions).toContain('A blocking outcome is valid only for concrete verified task-code defects');
    expect(instructions).toContain('Do not mark Review Outcome `blocking` because you are uncertain');
    expect(instructions).toContain('If the outcome is `blocking`, exit. Do not write `retrospective-input.md` or `final-summary.md`.');
    expect(instructions).toContain('re-open `final-summary.md`');
    expect(instructions).toContain('every generated `CR-*`, `COMP-*`, and `VAL-*` line is marked `verified` or `advisory`');
    expect(instructions).toContain('`## QA Status` is exactly `passed` or `issues-found`');
  });

  it('tells retrospective Ron not to stop with a prose-only update', () => {
    const prompt = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'prompts', 'retrospective-task.prompt.md'),
      'utf-8',
    );

    expect(prompt).toContain('This launch is non-interactive');
    expect(prompt).toContain('You will not receive follow-up input');
    expect(prompt).toContain('Do not stop with a prose summary or a promise to update the artifact later');
    expect(prompt).toContain('Stop when the five cycle-level sections of `retrospective-input.md` are populated');
  });
});
