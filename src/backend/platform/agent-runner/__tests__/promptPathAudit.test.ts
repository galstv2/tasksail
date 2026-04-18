import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This regex is a stand-in for the Copilot CLI's POSIX-style variable expander,
// which performs $NAME and ${NAME} substitution at agent launch time using the
// env constructed by buildAgentEnvironment (§1.3). It is NOT production code.
const posixExpand = (text: string, env: Record<string, string>): string =>
  text.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, n) => env[n] ?? '');

const env = {
  COPILOT_HANDOFFS_DIR: 'AgentWorkSpace/tasks/t1/handoffs',
  COPILOT_IMPL_STEPS_DIR: 'AgentWorkSpace/tasks/t1/ImplementationSteps',
};

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

const MIGRATED_FILES = [
  '.github/copilot/instructions/qa.instructions.md',
  '.github/copilot/instructions/global.instructions.md',
  '.github/copilot/instructions/product-manager.instructions.md',
  '.github/copilot/instructions/planning-agent.instructions.md',
  '.github/copilot/prompts/close-task.prompt.md',
  '.github/copilot/prompts/start-task.prompt.md',
  '.github/copilot/prompts/plan-task.prompt.md',
];

describe('promptPathAudit — §1.7 migration', () => {
  // Per-file: no bare literal paths remain; env-var references expand correctly
  for (const relPath of MIGRATED_FILES) {
    it(`${relPath}: no bare literal paths and env vars expand`, () => {
      const raw = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      const rendered = posixExpand(raw, env);

      // No bare literals before expansion
      expect(raw, 'raw must not contain AgentWorkSpace/handoffs').not.toContain(
        'AgentWorkSpace/handoffs',
      );
      expect(raw, 'raw must not contain AgentWorkSpace/ImplementationSteps').not.toContain(
        'AgentWorkSpace/ImplementationSteps',
      );

      // If the file references COPILOT_HANDOFFS_DIR it must expand into the task path
      if (raw.includes('COPILOT_HANDOFFS_DIR')) {
        expect(rendered, 'COPILOT_HANDOFFS_DIR must expand to task path').toContain(
          'tasks/t1/handoffs',
        );
      }

      // If the file references COPILOT_IMPL_STEPS_DIR it must expand into the task path
      if (raw.includes('COPILOT_IMPL_STEPS_DIR')) {
        expect(rendered, 'COPILOT_IMPL_STEPS_DIR must expand to task path').toContain(
          'tasks/t1/ImplementationSteps',
        );
      }
    });
  }

  // Aggregate: across all 7 files the expanded corpus contains BOTH task paths
  it('corpus renders both tasks/t1/handoffs and tasks/t1/ImplementationSteps', () => {
    const corpus = MIGRATED_FILES.map((f) =>
      posixExpand(readFileSync(join(REPO_ROOT, f), 'utf-8'), env),
    ).join('\n');

    expect(corpus).toContain('tasks/t1/handoffs');
    expect(corpus).toContain('tasks/t1/ImplementationSteps');

    // No unresolved bare literals survive expansion
    expect(corpus).not.toContain('AgentWorkSpace/handoffs');
    expect(corpus).not.toContain('AgentWorkSpace/ImplementationSteps');
  });
});
