import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCopilotPlannerLaunchSpec } from '../providers/copilot/plannerAdapter.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../../../..');
const instructionsPath = path.join(
  repoRoot,
  '.github/copilot/instructions/planning-agent.instructions.md',
);
const rootCopilotInstructionsPath = path.join(repoRoot, '.github/copilot-instructions.md');
const globalInstructionsPath = path.join(repoRoot, '.github/copilot/instructions/global.instructions.md');

const PLANNER_TIME_EXEMPT = new Set<string>([
  'COPILOT_HANDOFFS_DIR',
  'COPILOT_IMPL_STEPS_DIR',
]);

function extractCopilotEnvVarsFromMarkdown(text: string): Set<string> {
  const refs = new Set<string>();
  const patterns = [/\$([A-Z][A-Z0-9_]*)/g, /\b(COPILOT_[A-Z0-9_]+)\b/g];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const name = match[1];
      if (name?.startsWith('COPILOT_')) {
        refs.add(name);
      }
    }
  }
  return refs;
}

describe('Lily planner instructions env contract', () => {
  it('injects every planner-time COPILOT_* var referenced by the planning-agent instructions', () => {
    const text = fs.readFileSync(instructionsPath, 'utf-8');
    const referenced = [...extractCopilotEnvVarsFromMarkdown(text)]
      .filter((name) => !PLANNER_TIME_EXEMPT.has(name));

    const spec = buildCopilotPlannerLaunchSpec({
      model: 'claude-sonnet-4.6',
      promptMode: 'one-shot',
      contextPackBoundaryEnforced: true,
      focusEnv: {
        platformRepoRoot: repoRoot,
        handoffsDir: '/tmp/handoffs',
        implStepsDir: '/tmp/impl-steps',
        targetReposJson: '[]',
        primaryFocusPath: 'libs/Acme.Models',
        primaryFocusTargetKind: 'directory',
        primaryFocusTargetsJson: '[]',
        writableRootsJson: '[]',
        readonlyContextRootsJson: '[]',
        testTargetPath: 'libs/Acme.Models.Tests',
        testTargetKind: 'directory',
        contextPackPaths: '/tmp/context-pack',
        contextPackSearchRoots: '/tmp/context-pack',
      },
    });

    const injected = new Set(Object.keys(spec.env ?? {}));
    const missing = referenced.filter((key) => !injected.has(key));
    expect(
      missing,
      'planning-agent.instructions.md references planner-time env vars that buildCopilotPlannerLaunchSpec does not inject.',
    ).toEqual([]);
  });

  it('keeps platform workflow terms out of recommended task subject matter', () => {
    const text = fs.readFileSync(instructionsPath, 'utf-8');

    expect(text).toContain('## Context-Pack Subject Boundary');
    expect(text).toContain('Your grounding authority for the task subject is the platform-provided staged shell/session context');
    expect(text).toContain('Use those fields as the source of truth');
    expect(text).toContain('Do not treat them as candidate task subjects');
    expect(text).toContain('ground recommendations in the selected context-pack repos');
    expect(text).toContain('instead of proposing platform queue, staging, or workflow-infrastructure work');
  });

  it('marks global control-plane repo descriptions as operating context outside platform tasks', () => {
    const rootInstructions = fs.readFileSync(rootCopilotInstructionsPath, 'utf-8');
    const globalInstructions = fs.readFileSync(globalInstructionsPath, 'utf-8');

    for (const text of [rootInstructions, globalInstructions]) {
      expect(text).toContain('that context pack is the task subject');
      expect(text).toContain('This control-plane repository description is operating context only');
      expect(text).toContain('unless the active context pack points at this repository');
      expect(text).toContain('or the Guide explicitly asks for platform workflow changes');
    }
  });

  it('treats delegated authority as permission to decide instead of asking preference questions', () => {
    const text = fs.readFileSync(instructionsPath, 'utf-8');

    expect(text).toContain('When the Guide delegates judgment');
    expect(text).toContain('stop asking preference questions');
    expect(text).toContain('Make the smallest sound staff-engineer decision');
    expect(text).toContain('Ask again only if the missing answer would change the requested outcome');
    expect(text).toContain('"one decision," "one detail," "final decision," "last blocker,"');
  });
});
