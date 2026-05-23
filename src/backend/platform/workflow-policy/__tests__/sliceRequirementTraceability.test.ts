import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../core/index.js';
import { PolicyValidator } from '../index.js';
import { evaluateSliceQualityRules } from '../rules/slice.js';

const TEST_TASK_ID = 'task-test-001';

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
          agent_id: 'product-manager',
          role_name: 'Product Manager',
          human_name: 'Alice',
          instruction_path: '.github/copilot/instructions/product-manager.instructions.md',
          agent_profile_path: '.github/agents/product-manager.md',
          autonomy_profile: 'artifact-author',
          workflow_order: 1,
          required_model: 'gpt-5.4',
        },
      ],
    }, null, 2),
  );
}

function createWorkspace(repoRoot: string): void {
  createRegistryFixture(repoRoot);
  const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
  mkdirSync(handoffs, { recursive: true });
  mkdirSync(implementationSteps, { recursive: true });
  writeFileSync(
    path.join(handoffs, 'professional-task.md'),
    '# Professional Task\n\n## Task Metadata\n- Task ID: task-test-001\n',
    'utf-8',
  );
  for (const fileName of ['retrospective-input.md', 'final-summary.md', 'issues.md']) {
    writeFileSync(path.join(handoffs, fileName), '', 'utf-8');
  }
}

function implementationSpec(options: {
  intakeRequirements?: string;
  requirementHandling?: string;
  validationStrategy?: string;
  testCoverage?: string;
} = {}): string {
  return [
    '# Implementation Spec',
    '',
    '## Task Metadata',
    '- Task ID: task-test-001',
    '',
    options.intakeRequirements ?? [
      '## Intake Requirements',
      '',
      '### Critical Requirements',
      '- CR-001: Preserve the queue ordering contract.',
      '',
      '### Compatibility Requirements',
      '- COMP-001: Existing task activation still works.',
      '',
      '### Required Validation',
      '- VAL-001: Run pnpm run lint.',
    ].join('\n'),
    '',
    '## Implementation Plan',
    '',
    '### Requirement Handling',
    options.requirementHandling ?? '- CR-001 handled globally. - COMP-001 handled globally.',
    '',
    '## Validation and Evidence',
    '',
    '### Validation Strategy',
    options.validationStrategy ?? '- VAL-001 is covered by `pnpm run lint`.',
    '',
    '### Test Coverage',
    options.testCoverage ?? 'None.',
  ].join('\n');
}

function sliceMarkdown(options: {
  coverage?: string;
  scope?: string;
  acceptance?: string;
  unitTests?: string;
  validationCommands?: string;
  guards?: string;
} = {}): string {
  return [
    '# Slice Template',
    '',
    '## Objective',
    '### Purpose',
    'Implement the focused change.',
    '',
    '## Dependencies and Order',
    '### Depends On',
    'None.',
    '',
    '## Execution Scope',
    '### Scope',
    options.scope ?? '- Implement code for CR-001.',
    '',
    '### Requirement Coverage',
    options.coverage ?? '- CR-001',
    '',
    '## Files and Interfaces',
    '### Files',
    '- src/example.ts',
    '',
    '## Acceptance and Validation',
    '### Acceptance Criteria',
    options.acceptance ?? '- COMP-001 remains compatible.',
    '',
    '### Unit Tests',
    options.unitTests ?? '- Add unit coverage.',
    '',
    '### Validation Commands',
    options.validationCommands ?? '```bash\npnpm run lint\n```',
    '',
    '## Guards and Coordination',
    '### Guards',
    options.guards ?? 'None.',
  ].join('\n');
}

async function runSliceRules(repoRoot: string, mode: 'pre-slice' | 'lint' | 'ci' = 'pre-slice') {
  const validator = new PolicyValidator({ rootDir: repoRoot, mode, taskId: TEST_TASK_ID });
  await validator.initialize();
  await evaluateSliceQualityRules(validator);
  return validator.violations.filter((violation) => (
    violation.rule_id.startsWith('slice.requirement-id-')
    || violation.rule_id === 'slice.validation-id-covered'
  ));
}

describe('slice requirement traceability', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  function setup(): { repoRoot: string; handoffsDir: string; stepsDir: string } {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'slice-requirement-traceability-'));
    createdRoots.push(repoRoot);
    createWorkspace(repoRoot);
    const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
    return { repoRoot, handoffsDir: handoffs, stepsDir: implementationSteps };
  }

  it('passes when generated IDs are accounted for across plan and slice validation surfaces', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec(), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown(), 'utf-8');

    await expect(runSliceRules(repoRoot)).resolves.toEqual([]);
  });

  it('passes when global CR and COMP IDs appear only in Requirement Handling', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec(), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      scope: '- Implement validation plumbing.',
      coverage: 'None',
      acceptance: '- The implementation remains scoped.',
    }), 'utf-8');

    await expect(runSliceRules(repoRoot)).resolves.toEqual([]);
  });

  it('passes without requiring every slice to reference every generated ID', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec(), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({ coverage: '- CR-001' }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-2.md'), sliceMarkdown({
      scope: '- Infrastructure setup only.',
      coverage: 'None',
      acceptance: '- Setup remains isolated.',
    }), 'utf-8');

    await expect(runSliceRules(repoRoot)).resolves.toEqual([]);
  });

  it('fails when a generated CR is missing from authored downstream content', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      requirementHandling: '- COMP-001 handled globally.',
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      scope: '- Implement compatibility behavior.',
      coverage: '- COMP-001',
      acceptance: '- COMP-001 remains compatible.',
    }), 'utf-8');

    const violations = await runSliceRules(repoRoot);
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'slice.requirement-id-covered',
        artifact: 'implementation-spec.md',
        message: expect.stringContaining('CR-001'),
      }),
    ]));
  });

  it('fails only validation coverage when VAL appears outside validation surfaces', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      requirementHandling: '- CR-001 handled globally. - COMP-001 handled globally. - VAL-001 handled outside validation.',
      validationStrategy: '- Run the required command.',
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      coverage: '- CR-001',
      validationCommands: '```bash\npnpm run lint\n```',
    }), 'utf-8');

    const violations = await runSliceRules(repoRoot);
    expect(violations.filter((violation) => violation.message.includes('VAL-001'))).toEqual([
      expect.objectContaining({ rule_id: 'slice.validation-id-covered' }),
    ]);
  });

  it('fails when a slice references an unknown generated requirement ID', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec(), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      coverage: '- CR-001\n- COMP-009',
    }), 'utf-8');

    const violations = await runSliceRules(repoRoot);
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'slice.requirement-id-known',
        artifact: expect.stringContaining('slice-1.md'),
        message: expect.stringContaining('COMP-009'),
      }),
    ]));
  });

  it('fails unknown IDs when generated ID set is empty', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      intakeRequirements: [
        '## Intake Requirements',
        '',
        '### Critical Requirements',
        'None',
        '',
        '### Compatibility Requirements',
        'None',
        '',
        '### Required Validation',
        'None',
      ].join('\n'),
      requirementHandling: '- CR-001 should not exist.',
      validationStrategy: '- Manual validation.',
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({ coverage: 'None' }), 'utf-8');

    const violations = await runSliceRules(repoRoot);
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'slice.requirement-id-known',
        artifact: 'implementation-spec.md',
        message: expect.stringContaining('CR-001'),
      }),
    ]));
  });

  it('skips traceability failures when implementation-spec.md is missing or blank', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), '', 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({ coverage: '- CR-001' }), 'utf-8');

    await expect(runSliceRules(repoRoot)).resolves.toEqual([]);
  });

  it('skips traceability failures when Intake Requirements is absent', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      intakeRequirements: '',
      requirementHandling: '- CR-001 handled globally.',
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({ coverage: '- CR-001' }), 'utf-8');

    await expect(runSliceRules(repoRoot)).resolves.toEqual([]);
  });

  it('runs in pre-slice mode and ignores IDs inside comments and fences', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      requirementHandling: [
        '<!-- CR-001 comment must not count -->',
        '```',
        'COMP-001 fenced text must not count',
        '```',
      ].join('\n'),
      validationStrategy: [
        '<!-- VAL-001 comment must not count -->',
        '```bash',
        'echo VAL-001',
        '```',
      ].join('\n'),
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      scope: '- Implement scoped work.',
      coverage: 'None',
      acceptance: '- The change is complete.',
    }), 'utf-8');

    const violations = await runSliceRules(repoRoot, 'pre-slice');
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: 'slice.requirement-id-covered', message: expect.stringContaining('CR-001') }),
      expect.objectContaining({ rule_id: 'slice.requirement-id-covered', message: expect.stringContaining('COMP-001') }),
      expect.objectContaining({ rule_id: 'slice.requirement-id-covered', message: expect.stringContaining('VAL-001') }),
    ]));
  });

  it('counts requirement IDs in real non-comment authored content', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFileSync(path.join(handoffsDir, 'implementation-spec.md'), implementationSpec({
      requirementHandling: '- CR-001 handled globally.\n- COMP-001 handled globally.',
      validationStrategy: '- VAL-001 is covered by focused tests.',
    }), 'utf-8');
    writeFileSync(path.join(stepsDir, 'slice-1.md'), sliceMarkdown({
      coverage: '<!-- CR-999 must not count -->\n- CR-001',
      validationCommands: '<!-- VAL-999 must not count -->\n```bash\npnpm run lint\n```\n- VAL-001',
    }), 'utf-8');

    await expect(runSliceRules(repoRoot, 'pre-slice')).resolves.toEqual([]);
  });
});
