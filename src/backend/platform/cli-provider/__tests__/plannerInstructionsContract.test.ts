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

});
