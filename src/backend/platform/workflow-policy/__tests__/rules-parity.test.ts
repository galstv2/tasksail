import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PolicyValidator } from '../index.js';
import { resolvePaths } from '../../core/index.js';
import { evaluateCloseoutRules } from '../rules/closeout.js';
import { evaluateParallelOkContentRules } from '../rules/parallelOkContent.js';
import { evaluateTransitionLegalityRules } from '../rules/transition.js';

function writeRepoFile(repoRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
}

function createRegistryFixture(repoRoot: string): void {
  writeRepoFile(
    repoRoot,
    '.github/agents/registry.json',
    JSON.stringify({
      agents: [
        {
          agent_id: 'planning-agent',
          role_name: 'Planning Specialist',
          human_name: 'Lily',
          instruction_path: '.github/copilot/instructions/planning-agent.instructions.md',
          agent_profile_path: '.github/agents/planning-agent.md',
          autonomy_profile: 'artifact-author',
          workflow_order: 0,
          required_model: 'gpt-5.4',
        },
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
  );
}

const TEST_TASK_ID = 'task-123';

function handoffsPath(repoRoot: string, fileName: string): string {
  return path.relative(repoRoot, path.join(
    resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs,
    fileName,
  ));
}

function taskRuntimePath(repoRoot: string, relativePath: string): string {
  return path.relative(repoRoot, path.join(
    resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).taskRuntime,
    relativePath,
  ));
}

function createActiveTaskFixture(repoRoot: string): void {
  writeRepoFile(
    repoRoot,
    handoffsPath(repoRoot, 'professional-task.md'),
    [
      '# Professional Task',
      '',
      '## Task Metadata',
      '- Task ID: task-123',
      '- Task Title: Workflow policy parity',
      '',
      '## Problem Statement',
      'Port rule families without changing behavior.',
      '',
    ].join('\n'),
  );

  for (const fileName of ['implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md']) {
    writeRepoFile(repoRoot, handoffsPath(repoRoot, fileName), '');
  }
}

describe('workflow-policy rule parity', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('preserves closeout retrospective wording and full-ceremony contribution checks', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-closeout-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTaskFixture(repoRoot);

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'issues.md'),
      [
        '# QA Issues',
        '',
        '## Review Outcome',
        'advisory',
        '',
      ].join('\n'),
    );

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'final-summary.md'),
      [
        '# Final Summary',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Completed Work',
        '- Ported the validator.',
        '',
        '## Key Design Decisions',
        '- Preserved Python ordering.',
        '',
        '## Known Limitations',
        '- None.',
        '',
        '## Difficulty Assessment',
        '- Difficulty Level: Medium',
        '',
      ].join('\n'),
    );

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'retrospective-input.md'),
      [
        '# Retrospective Input',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '- Retrospective Required: true',
        '',
        '## Retrospective Summary',
        'Useful retrospective summary.',
        '',
        '## What Went Well',
        '- The TypeScript port stayed close to Python.',
        '',
        '## What Could Have Gone Better',
        '- More baseline fixtures would help.',
        '',
        '## Action Items',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-closeout', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateCloseoutRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'closeout.retrospective-action-items-required',
          severity: 'warning',
          message:
            'Retrospective action items are incomplete in retrospective-input.md; Action Items must contain at least one bullet.',
        }),
        expect.objectContaining({
          rule_id: 'closeout.retrospective-role-contributions-required',
          severity: 'warning',
          message:
            "Retrospective is missing contribution sections in retrospective-input.md; missing or blank: Lily's Contribution (Planning Specialist), Alice's Contribution (Product Manager), Dalton's Contribution (Software Engineer), Ron's Contribution (QA and Closeout).",
        }),
      ]),
    );
  });

  it('preserves transition severity downgrades for queue-advance mode', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-transition-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTaskFixture(repoRoot);

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'final-summary.md'),
      [
        '# Final Summary',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Closeout Owner Agent ID',
        'product-manager',
        '',
        '## Completed Work',
        '- Done.',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'queue-advance', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateTransitionLegalityRules(validator);

    expect(validator.violations).toEqual([
      expect.objectContaining({
        rule_id: 'closeout.owner-agent-valid',
        severity: 'warning',
        message: "Final-summary closeout must be owned by 'qa', found 'product-manager'.",
      }),
    ]);
  });

  it('accepts passed status receipts as remediation-loop execution evidence', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-remediation-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTaskFixture(repoRoot);

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'issues.md'),
      [
        '# QA Issues',
        '',
        '## Severity',
        'blocking',
        '',
        '## Remediation Owner Agent ID',
        'software-engineer',
        '',
        '## Revalidation Agent ID',
        'qa',
        '',
        '## Return-To Agent ID',
        'qa',
        '',
      ].join('\n'),
    );
    writeRepoFile(
      repoRoot,
      taskRuntimePath(repoRoot, 'guardrails/software-engineer.json'),
      JSON.stringify({ status: 'passed' }, null, 2),
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      requestedAgentId: 'qa',
      resolveExpectedRuntimeAgent: () => ({
        expectedAgentId: 'qa',
        expectedSource: 'test fixture',
      }),
    });
    await validator.initialize();
    await evaluateTransitionLegalityRules(validator);

    expect(
      validator.violations.some(
        (violation) => violation.rule_id === 'runtime.remediation-loop-execution-required',
      ),
    ).toBe(false);
  });

  it('preserves parallel-ok approval checks against runtime facts and slice inventory', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-parallel-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTaskFixture(repoRoot);

    writeRepoFile(
      repoRoot,
      taskRuntimePath(repoRoot, 'workflow-facts.json'),
      JSON.stringify({
        schema_version: 1,
        source: 'typescript',
        generated_at: new Date().toISOString(),
        completion: {},
        parallel: { active_approval: true },
        next_agent_id: 'software-engineer',
        next_agent_source: 'typescript runtime completion',
      }, null, 2),
    );

    writeRepoFile(
      repoRoot,
      handoffsPath(repoRoot, 'parallel-ok.md'),
      [
        '# Parallel OK',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Decision',
        'complex',
        '',
        '## Independent Slices',
        '- slice-42 owns workflow parity',
        '',
        '## Constraints',
        '',
      ].join('\n'),
    );

    const implStepsDir = path.relative(
      repoRoot,
      resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).implementationSteps,
    );
    writeRepoFile(
      repoRoot,
      `${implStepsDir}/slice-1.md`,
      [
        '# Slice 1',
        '',
        '## Purpose',
        'Existing slice.',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-slice', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateParallelOkContentRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'parallel-ok.constraints-populated',
          severity: 'warning',
          message: 'Constraints section is empty when Complex orchestrator execution is approved.',
          remediation: 'Add sequencing, shared-file, resource, validation, or coordination constraints (or \'None\') to the Constraints section in parallel-ok.md.',
        }),
        expect.objectContaining({
          rule_id: 'parallel-ok.slices-exist',
          severity: 'warning',
          message: expect.stringContaining("Independent Slices references 'slice-42' but no matching file exists in"),
        }),
      ]),
    );
  });
});
