import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('Alice prompt contracts', () => {
  it('anchors the product-manager startup prompt to instructions, worktrees, and template shape', () => {
    const prompt = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'prompts', 'start-task.prompt.md'),
      'utf-8',
    );

    expect(prompt).toContain('read `.github/copilot/instructions/product-manager.instructions.md`');
    expect(prompt).toContain('## Product Manager Artifact Checklist');
    expect(prompt).toContain('TASKSAIL_TASK_WORKTREES');
    expect(prompt).toContain('TASKSAIL_TASK_WORKTREES_FILE');
    expect(prompt).toContain("Use only each entry's `worktreeRoot` as source code");
    expect(prompt).toContain('Never inspect `contextpacks/...` paths as source code');
    expect(prompt).toContain('create every `slice-N.md` as a copy of `AgentWorkSpace/templates/slice-template.md`');
    expect(prompt).toContain('preserve every seeded `##` and `###` heading');
    expect(prompt).toContain('This launch is non-interactive');
    expect(prompt).toContain('You will not receive follow-up input');
    expect(prompt).toContain('Do not exit with a prose-only status');
    expect(prompt).toContain('After source inspection, immediately begin the artifact sequence by writing `implementation-spec.md`');
    expect(prompt).toContain('then continue to create and populate every planned `slice-N.md`, and write `parallel-ok.md` last');
  });

  it('tells Alice that active source inspection uses task worktree roots', () => {
    const instructions = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'instructions', 'product-manager.instructions.md'),
      'utf-8',
    );

    expect(instructions).toContain('## Source Code Lookup Rules');
    expect(instructions).toContain('## Product Manager Artifact Checklist');
    expect(instructions).toContain('launch-specific artifact ownership and sequencing checklist');
    expect(instructions).toContain('Before inspecting source code, resolve the task worktree source roots');
    expect(instructions).toContain('Runtime Path Manifest lists `TASKSAIL_TASK_WORKTREES`');
    expect(instructions).toContain('TASKSAIL_TASK_WORKTREES_FILE');
    expect(instructions).toContain('The only source-code roots for this task are those `worktreeRoot` values');
    expect(instructions).toContain('Never inspect `contextpacks/...` or `AgentWorkSpace/qmd/...` as source code');
    expect(instructions).toContain('If no equivalent exists under any `worktreeRoot`, document the missing source');
    expect(instructions).toContain('every `worktreeRoot` searched');
    expect(instructions).toContain('## Non-Interactive Launch Contract');
    expect(instructions).toContain('You will not receive follow-up input');
    expect(instructions).toContain('Do not stop after source inspection, analysis, a plan, or a promise to continue');
    expect(instructions).toContain('continue completing every artifact that can still be completed');
    expect(instructions).toContain('then continue to create and populate every planned `slice-N.md`, and write `parallel-ok.md` last');
    expect(instructions).toContain('Do not finish with a prose-only status update');
    expect(instructions).not.toContain('The four most frequently missed sections are');
  });

  it('does not put non-interactive launch language in global instructions seen by interactive roles', () => {
    const globalInstructions = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'instructions', 'global.instructions.md'),
      'utf-8',
    );

    expect(globalInstructions).not.toContain('This launch is non-interactive');
    expect(globalInstructions).not.toContain('You will not receive follow-up input');
    expect(globalInstructions).not.toContain('Product Manager Artifact Checklist');
    expect(globalInstructions).not.toContain('QA Artifact Checklist');
  });
});
