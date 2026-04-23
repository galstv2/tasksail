import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RULE_EVALUATORS,
  FULL_EVALUATION_SEQUENCE,
  LIGHTWEIGHT_EVALUATION_SEQUENCE,
  PolicyValidator,
} from '../index.js';

const TEST_TASK_ID = 'task-test-001';

function createRegistryFixture(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'registry.json'),
    JSON.stringify({
      agents: [
        {
          agent_id: 'product-manager',
          role_name: 'Product Manager',
          human_name: 'Alice',
          instruction_path: '.github/copilot/instructions/product-manager.instructions.md',
          agent_profile_path: '.github/agents/product-manager.md',
          autonomy_profile: 'artifact-author',
          workflow_order: 1,
          required_model: 'gpt-5.4',
        },
        {
          agent_id: 'software-engineer',
          role_name: 'Software Engineer',
          human_name: 'Dalton',
          instruction_path: '.github/copilot/instructions/software-engineer.instructions.md',
          agent_profile_path: '.github/agents/software-engineer.md',
          autonomy_profile: 'repo-executor',
          workflow_order: 2,
          required_model: 'gpt-4.1',
        },
        {
          agent_id: 'qa',
          role_name: 'QA and Closeout',
          human_name: 'Ron',
          instruction_path: '.github/copilot/instructions/qa.instructions.md',
          agent_profile_path: '.github/agents/qa.md',
          autonomy_profile: 'artifact-author',
          workflow_order: 3,
          required_model: 'gpt-5.4',
        },
      ],
    }, null, 2),
    'utf-8',
  );
}

function createWorkspaceFixture(repoRoot: string): void {
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });

  writeFileSync(
    path.join(handoffsDir, 'professional-task.md'),
    [
      '## Task Metadata',
      '- Task ID: task-123',
      '',
      '## Problem Statement',
      'Ship the workflow policy foundation.',
      '',
    ].join('\n'),
    'utf-8',
  );

  for (const fileName of [
    'implementation-spec.md',
    'retrospective-input.md',
    'final-summary.md',
    'issues.md',
  ]) {
    writeFileSync(path.join(handoffsDir, fileName), '', 'utf-8');
  }
}

describe('PolicyValidator', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('preserves the Python full evaluation order for standard modes', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-full-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createWorkspaceFixture(repoRoot);

    const seen: string[] = [];
    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      ruleEvaluators: Object.fromEntries(
        FULL_EVALUATION_SEQUENCE.map((ruleName) => [ruleName, () => void seen.push(ruleName)]),
      ),
    });

    const result = await validator.evaluate();

    expect(seen).toEqual([...FULL_EVALUATION_SEQUENCE]);
    expect(result.status).toBe('ok');
    expect(result.phase).toBe('fail-closed');
    expect(result.guardrail?.status).toBe('not-requested');
    expect(result.next_steps).toEqual(['No workflow-policy violations were detected for the current mode.']);
  });

  it('uses the lightweight path for pre-closeout and queue-advance modes', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-lite-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createWorkspaceFixture(repoRoot);

    const seen: string[] = [];
    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: Object.fromEntries(
        LIGHTWEIGHT_EVALUATION_SEQUENCE.map((ruleName) => [ruleName, () => void seen.push(ruleName)]),
      ),
    });

    await validator.evaluate();

    expect(seen).toEqual([...LIGHTWEIGHT_EVALUATION_SEQUENCE]);
  });

  it('returns a denied guardrail result for an unknown requested agent id', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-guardrail-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createWorkspaceFixture(repoRoot);

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      requestedAgentId: 'mystery-agent',
    });

    const result = await validator.evaluate();

    expect(result.guardrail).toMatchObject({
      status: 'denied',
      requested_agent_id: 'mystery-agent',
      validator_mode: 'runtime',
      launch_seam: 'workflow-policy-validator',
    });
    expect(result.guardrail?.violations).toEqual([
      expect.objectContaining({
        rule_id: 'guardrail.unknown-agent-id',
        artifact: '.github/agents/registry.json',
      }),
    ]);
  });
});
