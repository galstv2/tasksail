import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// This regex is a stand-in for the Copilot CLI's POSIX-style variable expander,
// which performs $NAME and ${NAME} substitution at agent launch time using the
// env constructed by buildAgentEnvironment (§1.3). It is NOT production code.
const posixExpand = (text: string, env: Record<string, string>): string =>
  text.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, n) => env[n] ?? '');

const env = {
  COPILOT_HANDOFFS_DIR: 'AgentWorkSpace/tasks/t1/handoffs',
  COPILOT_IMPL_STEPS_DIR: 'AgentWorkSpace/tasks/t1/ImplementationSteps',
  TASKSAIL_REALIGNMENT_STAGING_PATH: '.platform-state/runtime/realignment/r1/analysis.md',
};

const REPO_ROOT = join(import.meta.dirname, '../../../../..');

const MIGRATED_FILES = [
  '.github/copilot/instructions/qa.instructions.md',
  '.github/copilot/instructions/global.instructions.md',
  '.github/copilot/instructions/product-manager.instructions.md',
  '.github/copilot/instructions/planning-agent.instructions.md',
  '.github/copilot/prompts/start-task.prompt.md',
  '.github/copilot/prompts/plan-task.prompt.md',
  '.github/copilot/prompts/retrospective-task.prompt.md',
  '.github/copilot/prompts/realignment-task.prompt.md',
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

      // If the file references TASKSAIL_REALIGNMENT_STAGING_PATH it must expand into the runtime staging path.
      if (raw.includes('TASKSAIL_REALIGNMENT_STAGING_PATH')) {
        expect(rendered, 'TASKSAIL_REALIGNMENT_STAGING_PATH must expand to runtime staging path').toContain(
          '.platform-state/runtime/realignment/r1/analysis.md',
        );
      }
    });
  }

  // Aggregate: across all migrated files the expanded corpus contains BOTH task paths
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

/**
 * Phase 6 — Codebase-wide regression guard.
 *
 * Asserts that no tracked file in the repo contains bare legacy singleton
 * paths (`AgentWorkSpace/handoffs` or `AgentWorkSpace/ImplementationSteps`)
 * outside of explicitly allowed locations.
 */
describe('codebase-wide legacy path regression guard', () => {
  const FORBIDDEN_LITERALS = [
    'AgentWorkSpace/handoffs',
    'AgentWorkSpace/ImplementationSteps',
  ] as const;

  // Files that are allowed to mention the forbidden literals:
  // - this test file itself (it defines the literals)
  // - scratchspace artefacts (planning docs, decision logs)
  const ALLOW_LIST_PATTERNS = [
    'src/backend/platform/agent-runner/__tests__/promptPathAudit.test.ts',
    'scratchspace/',
  ];

  function isAllowListed(filePath: string): boolean {
    return ALLOW_LIST_PATTERNS.some((p) => filePath.includes(p));
  }

  it('no tracked file references legacy AgentWorkSpace/handoffs or AgentWorkSpace/ImplementationSteps', () => {
    // Single git grep invocation searching both forbidden literals at once.
    let output: string;
    try {
      output = execFileSync(
        'git',
        [
          'grep', '-n', '--fixed-strings',
          '-e', FORBIDDEN_LITERALS[0],
          '-e', FORBIDDEN_LITERALS[1],
          '--', ':(exclude)scratchspace/',
        ],
        { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      );
    } catch {
      // git grep exits 1 when there are no matches — that's the success case.
      return;
    }

    const violations: string[] = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const filePart = line.split(':')[0];
      if (filePart && isAllowListed(filePart)) continue;

      // Skip negative assertions and test-description strings.
      if (
        line.includes('.not.toContain') ||
        line.includes('assertNotIn') ||
        line.includes('NEGATIVE_ASSERTIONS') ||
        line.includes('_NEGATIVE_ASSERTIONS') ||
        /\bit\(\s*['"`]/.test(line) ||
        /\bdescribe\(\s*['"`]/.test(line)
      ) {
        continue;
      }

      violations.push(line);
    }

    expect(
      violations,
      `Found ${violations.length} file(s) still referencing legacy singleton paths:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });
});
