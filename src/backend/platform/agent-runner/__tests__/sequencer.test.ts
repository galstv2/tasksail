import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildFleetDaltonCleanupContext,
  buildFleetDaltonCleanupPrompt,
  buildFleetPrompt,
  buildSimpleDaltonPrompt,
  detectWorkflowPath,
  detectParallelOk,
  getAgentOrder,
} from '../pipeline/sequencer.js';
import type { ExternalMcpRegistry } from '../../external-mcp-registry/index.js';

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'sequencer-test-'));
}

function writeRegularDaltonOverlayFixture(
  repoRoot: string,
  contextPackDir: string,
  options?: {
    includeConventions?: boolean;
    includeCorrections?: boolean;
    includeReinforcement?: boolean;
    correctionsAsDirectory?: boolean;
  },
): void {
  const {
    includeConventions = true,
    includeCorrections = true,
    includeReinforcement = true,
    correctionsAsDirectory = false,
  } = options ?? {};

  const repoContextAppPath = path.join(
    repoRoot,
    'src',
    'backend',
    'scripts',
    'python',
    'repo-context-app.py',
  );
  mkdirSync(path.dirname(repoContextAppPath), { recursive: true });
  writeFileSync(repoContextAppPath, '# repo context app', 'utf-8');

  const packName = path.basename(contextPackDir);
  const correctionMemoPath = path.join(
    contextPackDir,
    'qmd',
    'context-packs',
    packName,
    'canonical',
    'context-pack',
    'behavior-correction-memo.md',
  );
  mkdirSync(path.dirname(correctionMemoPath), { recursive: true });
  writeFileSync(correctionMemoPath, '# Correction memo', 'utf-8');

  if (includeConventions) {
    const conventionsPath = path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'context-pack-conventions.md',
    );
    mkdirSync(path.dirname(conventionsPath), { recursive: true });
    writeFileSync(conventionsPath, '# Conventions\nFollow the pack rules.', 'utf-8');
  }

  if (includeCorrections) {
    const correctionsPath = path.join(
      repoRoot,
      '.platform-state',
      'runtime',
      'context-pack-corrections.md',
    );
    mkdirSync(path.dirname(correctionsPath), { recursive: true });
    if (correctionsAsDirectory) {
      mkdirSync(correctionsPath, { recursive: true });
    } else {
      writeFileSync(correctionsPath, '# Corrections\nAvoid the previous bug.', 'utf-8');
    }
  }

  if (includeReinforcement) {
    const reinforcementPath = path.join(
      repoRoot,
      'AgentWorkSpace',
      'qmd',
      'global',
      'agent-rewards',
      'software-engineer.md',
    );
    mkdirSync(path.dirname(reinforcementPath), { recursive: true });
    writeFileSync(reinforcementPath, '# Reinforcement\nKeep changes tightly scoped.', 'utf-8');
  }
}

function createExternalMcpRegistry(agentIds: string[]): ExternalMcpRegistry {
  return {
    schema_version: 1,
    external_servers: [
      {
        id: 'prompt-guide',
        display_name: 'Prompt Guide',
        purpose: 'triaging implementation work',
        enabled: true,
        transport: 'http',
        url: 'http://localhost:8080/mcp',
        agent_scope: { mode: 'allowlist', agent_ids: agentIds },
      },
    ],
  };
}

describe('detectWorkflowPath', () => {
  it('always returns standard', async () => {
    const dir = makeTmpDir();
    const result = await detectWorkflowPath(dir);
    expect(result).toBe('standard');
  });
});

describe('detectParallelOk', () => {
  it('returns false when parallel-ok.md does not exist', async () => {
    const dir = makeTmpDir();
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false when file only has comments and whitespace', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Header\n<!-- comment -->\n\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false for the template-only file without an affirmative decision', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel OK\n\nUse this file only when slice independence is real.\n\n## Task Metadata\n\n- Task ID:\n\n## Decision\n<!-- (1 word) — write "complex" or "simple" -->\n\n## Independent Slices\n<!-- placeholder -->\n\n## Constraints\n<!-- placeholder -->\n\n## Coordination Notes\n<!-- placeholder -->\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns false when the decision explicitly requires simple execution', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel Authorization\n\n## Decision\n\nSimple execution required.\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(false);
  });

  it('returns true when file has complex decision', async () => {
    const dir = makeTmpDir();
    writeFileSync(
      path.join(dir, 'parallel-ok.md'),
      '# Parallel Authorization\n\n## Decision\n\nComplex execution authorized by Alice.\n',
    );
    const result = await detectParallelOk(dir);
    expect(result).toBe(true);
  });
});

describe('getAgentOrder', () => {
  it('returns standard order for standard path', () => {
    const order = getAgentOrder();
    expect(order[0]).toBe('alice');
    expect(order).toEqual(['alice', 'dalton', 'ron']);
  });

  it('returns the unattended active-task order', () => {
    const order = getAgentOrder();
    expect(order).toEqual(['alice', 'dalton', 'ron']);
  });
});

describe('buildFleetPrompt', () => {
  it('throws when no slice files exist', async () => {
    const dir = makeTmpDir();
    await expect(buildFleetPrompt(dir, dir)).rejects.toThrow(
      'no slice files found in ImplementationSteps/',
    );
  });

  it('includes all slice content in the prompt', async () => {
    const dir = makeTmpDir();
    const handoffsDir = path.join(dir, 'handoffs');
    const implStepsDir = path.join(dir, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Spec\nHonor the contract.', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice 1\nDo the first thing.');
    writeFileSync(path.join(implStepsDir, 'slice-2.md'), '# Slice 2\nDo the second thing.');
    const contextPackDir = path.join(dir, 'contextpacks', 'pack-a');
    writeRegularDaltonOverlayFixture(dir, contextPackDir);
    const prompt = await buildFleetPrompt(
      implStepsDir,
      handoffsDir,
      { primaryFocusRelativePath: 'services/sink' },
      createExternalMcpRegistry(['dalton']),
      { repoRoot: dir, contextPackDir },
    );
    expect(prompt).toContain('fleet mode');
    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('"Prompt Guide" may help with triaging implementation work');
    expect(prompt).toContain('Primary focus path: `services/sink/`');
    expect(prompt).toContain('Your launch CWD is already this folder.');
    expect(prompt).toContain('## Implementation Spec');
    expect(prompt).toContain('Honor the contract.');
    expect(prompt).toContain('## Behavioral Overlays');
    expect(prompt).toContain(
      'Supplemental behavioral guidance begins below. Apply these overlays in addition to the primary task content above.',
    );
    expect(prompt).toContain('### Conventions');
    expect(prompt).toContain('Follow the pack rules.');
    expect(prompt).toContain('### Corrections');
    expect(prompt).toContain('Avoid the previous bug.');
    expect(prompt).toContain('### Reinforcement');
    expect(prompt).toContain('Keep changes tightly scoped.');
    expect(prompt).toContain('## Slice: slice-1');
    expect(prompt).toContain('Do the first thing.');
    expect(prompt).toContain('## Slice: slice-2');
    expect(prompt).toContain('Do the second thing.');
    expect(prompt.indexOf('Honor the contract.')).toBeLessThan(prompt.indexOf('## Slice: slice-1'));
    expect(prompt.indexOf('## Slice: slice-2')).toBeLessThan(prompt.indexOf('## Behavioral Overlays'));
    expect(prompt).toContain('ensure all tests pass before exiting');
  });

  it('ignores slice-template.md', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-template.md'), 'Template content');
    writeFileSync(path.join(dir, 'slice-1.md'), 'Real slice content');
    const prompt = await buildFleetPrompt(dir, dir);
    expect(prompt).toContain('## Slice: slice-1');
    expect(prompt).not.toContain('Template content');
    expect(prompt).not.toContain('slice-template');
    expect(prompt).not.toContain('## Monolith Focus Scope');
  });
});

describe('buildFleetDaltonCleanupPrompt', () => {
  it('builds a generic cleanup prompt when QA is blocked without a Dalton artifact gap', () => {
    const prompt = buildFleetDaltonCleanupPrompt('');
    expect(prompt).toContain('did not leave the workflow ready for QA');
    expect(prompt).toContain('Inspect the code and validation results');
  });

  it('builds a cleanup prompt when inline cleanup context exists', () => {
    const prompt = buildFleetDaltonCleanupPrompt(
      [
        '## Blocking Workflow Violations',
        '',
        '- [error] closeout.qa-review-approved (issues.md): Ron marked QA as blocking.',
        '',
        '## Inline Blocking Artifact Context',
        '',
        '### issues.md',
        '',
        '## Review Outcome',
        '',
        'blocking',
      ].join('\n'),
      { primaryFocusRelativePath: 'services/sink' },
      createExternalMcpRegistry(['dalton']),
    );
    expect(prompt).toContain('did not leave the workflow ready for QA');
    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('Primary focus path: `services/sink/`');
    expect(prompt).toContain('closeout.qa-review-approved');
    expect(prompt).toContain('## Inline Blocking Artifact Context');
    expect(prompt).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(prompt).not.toContain('$COPILOT_IMPL_STEPS_DIR');
  });
});

describe('buildFleetDaltonCleanupContext', () => {
  it('inlines policy violations and blocking artifact content without handoff env vars', async () => {
    const dir = makeTmpDir();
    const TEST_TASK_ID = 'task-test-001';
    const handoffsDir = path.join(dir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    const implStepsDir = path.join(dir, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(
      path.join(handoffsDir, 'issues.md'),
      '# QA Issues\n\n## Review Outcome\n\nblocking\n\n## Required Fix\n\nTighten validation.\n',
    );

    const context = await buildFleetDaltonCleanupContext({
      repoRoot: dir,
      handoffsDir,
      implStepsDir,
      policyResult: {
        stdout: JSON.stringify({
          guardrail: {
            requested_agent_id: 'qa',
            expected_agent_id: 'software-engineer',
          },
          violations: [
            {
              severity: 'error',
              rule_id: 'closeout.qa-review-approved',
              artifact: 'AgentWorkSpace/tasks/task-test-001/handoffs/issues.md',
              message: 'Review Outcome is blocking.',
              remediation: 'Resolve the blocking findings before QA handoff.',
            },
          ],
          next_steps: ['Resolve the remaining blocking QA issue.'],
        }),
        stderr: '',
      },
    });

    expect(context).toContain('Workflow guardrail requires software-engineer instead of qa.');
    expect(context).toContain('closeout.qa-review-approved');
    expect(context).toContain('issues.md');
    expect(context).toContain('## Review Outcome');
    expect(context).toContain('Tighten validation.');
    expect(context).not.toContain('$COPILOT_HANDOFFS_DIR');
    expect(context).not.toContain('$COPILOT_IMPL_STEPS_DIR');
  });
});

describe('buildSimpleDaltonPrompt', () => {
  it('includes the shared monolith focus block when a primary focus path is provided', async () => {
    const dir = makeTmpDir();
    const handoffsDir = path.join(dir, 'handoffs');
    const implStepsDir = path.join(dir, 'ImplementationSteps');
    mkdirSync(handoffsDir, { recursive: true });
    mkdirSync(implStepsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '# Spec\nHonor the contract.', 'utf-8');
    writeFileSync(path.join(implStepsDir, 'slice-1.md'), '# Slice 1\nDo the first thing.');
    const contextPackDir = path.join(dir, 'contextpacks', 'pack-a');
    writeRegularDaltonOverlayFixture(dir, contextPackDir, { includeConventions: false });

    const prompt = await buildSimpleDaltonPrompt(
      implStepsDir,
      handoffsDir,
      { primaryFocusRelativePath: 'services/sink' },
      createExternalMcpRegistry(['dalton']),
      { repoRoot: dir, contextPackDir },
    );

    expect(prompt).toContain('## Monolith Focus Scope');
    expect(prompt).toContain('## External MCP Guidance');
    expect(prompt).toContain('Primary focus path: `services/sink/`');
    expect(prompt).toContain('Your launch CWD is already this folder.');
    expect(prompt).toContain('implementation changes must stay within the selected focus area.');
    expect(prompt).toContain('## Implementation Spec');
    expect(prompt).toContain('Honor the contract.');
    expect(prompt).toContain('## Implementation Slices (1 total)');
    expect(prompt).toContain('Do the first thing.');
    expect(prompt).toContain('## Behavioral Overlays');
    expect(prompt).toContain(
      'Supplemental behavioral guidance begins below. Apply these overlays in addition to the primary task content above.',
    );
    expect(prompt).not.toContain('### Conventions');
    expect(prompt).toContain('### Corrections');
    expect(prompt).toContain('Avoid the previous bug.');
    expect(prompt).toContain('### Reinforcement');
    expect(prompt).toContain('Keep changes tightly scoped.');
    expect(prompt.indexOf('Honor the contract.')).toBeLessThan(
      prompt.indexOf('## Implementation Slices (1 total)'),
    );
    expect(prompt.indexOf('Do the first thing.')).toBeLessThan(
      prompt.indexOf('## Behavioral Overlays'),
    );
  });

  it('skips unreadable overlay paths without failing prompt construction', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');
    const contextPackDir = path.join(dir, 'contextpacks', 'pack-a');
    writeRegularDaltonOverlayFixture(dir, contextPackDir, { correctionsAsDirectory: true });

    const prompt = await buildSimpleDaltonPrompt(
      dir,
      dir,
      undefined,
      undefined,
      { repoRoot: dir, contextPackDir },
    );

    expect(prompt).toContain('## Behavioral Overlays');
    expect(prompt).toContain('### Conventions');
    expect(prompt).not.toContain('### Corrections');
    expect(prompt).toContain('### Reinforcement');
  });

  it('preserves no-focus prompt behavior when no primary focus path is provided', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');

    const prompt = await buildSimpleDaltonPrompt(dir, dir);

    expect(prompt).not.toContain('## Monolith Focus Scope');
    expect(prompt).toContain('Implement the changes described above.');
  });

  it('omits external MCP guidance when Dalton has no in-scope servers', async () => {
    const dir = makeTmpDir();
    writeFileSync(path.join(dir, 'slice-1.md'), '# Slice 1\nDo the first thing.');

    const prompt = await buildSimpleDaltonPrompt(
      dir,
      dir,
      undefined,
      createExternalMcpRegistry(['ron']),
    );

    expect(prompt).not.toContain('## External MCP Guidance');
  });
});
