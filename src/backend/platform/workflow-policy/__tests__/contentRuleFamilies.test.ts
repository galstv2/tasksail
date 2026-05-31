import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PolicyValidator } from '../index.js';
import { resolvePaths } from '../../core/index.js';
import { evaluateIntakeQualityRules } from '../rules/intake.js';
import { evaluateSliceQualityRules } from '../rules/slice.js';
import { evaluateSpecQualityRules } from '../rules/spec.js';
import { evaluateTaskQualityRules } from '../rules/taskQuality.js';

const TEST_TASK_ID = 'task-test-001';
const REPO_ROOT = path.join(import.meta.dirname, '../../../../..');

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

function createBlankHandoffs(repoRoot: string): void {
  const handoffsDir = resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs;
  for (const fileName of [
    'professional-task.md',
    'implementation-spec.md',
    'retrospective-input.md',
    'final-summary.md',
    'issues.md',
  ]) {
    writeRepoFile(repoRoot, path.relative(repoRoot, path.join(handoffsDir, fileName)), '');
  }
}

async function validateIntakeMarkdown(repoRoot: string, content: string) {
  createRegistryFixture(repoRoot);
  createBlankHandoffs(repoRoot);
  writeRepoFile(repoRoot, 'AgentWorkSpace/dropbox/request.md', content);
  const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
  await validator.initialize();
  await evaluateIntakeQualityRules(validator);
  return validator.violations;
}

function canonicalIntake(requirementSections: string[]): string {
  return [
    '# Requirement request',
    '',
    '## Request Summary',
    'Preserve operator requirements through the planning intake workflow.',
    '',
    '## Desired Outcome',
    'The queued intake keeps explicit requirement sections.',
    '',
    '## Constraints',
    'None',
    '',
    ...requirementSections,
    '## Acceptance Signals',
    '- The intake validator accepts the canonical requirement spine.',
    '',
    '## Suggested Routing',
    '- Recommended Execution: Simple',
    '',
  ].join('\n');
}

function createActiveTask(repoRoot: string, extraLineage: string[] = []): void {
  createBlankHandoffs(repoRoot);
  const handoffsDir = resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs;
  writeRepoFile(
    repoRoot,
    path.relative(repoRoot, path.join(handoffsDir, 'professional-task.md')),
    [
      '# Professional Task',
      '',
      '## Task Metadata',
      '- Task ID: task-123',
      '- Task Title: Workflow policy parity',
      '',
      '## Task Lineage',
      ...extraLineage,
      ...(extraLineage.length ? [''] : []),
      '## Problem Statement',
      'Port rule families without changing behavior.',
      '',
      '## Business Goal',
      'Keep the TypeScript validator authoritative.',
      '',
      '## Scope',
      'Workflow policy content rules only.',
      '',
      '## Non-Goals',
      '- No queue caller changes.',
      '',
      '## Acceptance Criteria',
      '- Representative policy tests pass.',
      '',
    ].join('\n'),
  );
}

function generatedIntakeRequirementSpine(options: {
  critical?: string[];
  compatibility?: string[];
  validation?: string[];
} = {}): string {
  return [
    '## Intake Requirements',
    '<!-- Platform-generated from handoffs/intake.md during task activation. Do not edit or delete. -->',
    '',
    '### Critical Requirements',
    '',
    ...(options.critical ?? ['None']),
    '',
    '### Compatibility Requirements',
    '',
    ...(options.compatibility ?? ['None']),
    '',
    '### Required Validation',
    '',
    ...(options.validation ?? ['None']),
    '',
  ].join('\n');
}

function writeIntakeRequirementFixture(repoRoot: string, options: {
  critical?: string[];
  compatibility?: string[];
  validation?: string[];
  omitRequirementSections?: boolean;
} = {}): void {
  const handoffsDir = resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs;
  const requirementSections = options.omitRequirementSections
    ? []
    : [
      '## Critical Requirements',
      ...(options.critical ?? ['None']),
      '',
      '## Compatibility Requirements',
      ...(options.compatibility ?? ['None']),
      '',
      '## Required Validation',
      ...(options.validation ?? ['None']),
      '',
    ];
  writeRepoFile(
    repoRoot,
    path.relative(repoRoot, path.join(handoffsDir, 'intake.md')),
    [
      '# Intake',
      '',
      '## Request Summary',
      'Implement the task.',
      '',
      ...requirementSections,
    ].join('\n'),
  );
}

function writeMinimalImplementationSpec(repoRoot: string, intakeSpine: string | null): void {
  const handoffsDir = resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs;
  writeRepoFile(
    repoRoot,
    path.relative(repoRoot, path.join(handoffsDir, 'implementation-spec.md')),
    [
      '# Implementation Spec',
      '',
      '## Task Metadata',
      '- Task ID: task-123',
      '',
      ...(intakeSpine === null ? [] : [intakeSpine, '']),
      '## Problem Statement',
      'Port the content rules.',
      '',
      '## Goals',
      '- Preserve parity.',
      '',
      '## Non-Goals',
      '- No queue/runtime cutover.',
      '',
      '## Architecture Summary',
      'Use the workflow-policy foundation.',
      '',
      '## Touched Systems',
      '- workflow-policy',
      '',
      '## Change Boundaries',
      'Rules and tests only.',
      '',
      '## Dependency Analysis',
      '| Module | Depends On |',
      '|---|---|',
      '| spec.ts | artifacts.ts |',
      '',
      '## Codebase Analysis',
      'The content rules already live under rules/*.ts.',
      '',
      '## Proposed Structure',
      'Keep one file per rule family.',
      '',
      '## Validation Strategy',
      '```bash',
      'pnpm exec vitest run --config src/backend/platform/vitest.config.ts src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
      '```',
      '',
      '## Files or Areas Likely to Change',
      '- src/backend/platform/workflow-policy/',
      '',
    ].join('\n'),
  );
}

describe('workflow-policy content rule families', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('keeps Alice instructions aligned with Dalton-ready slice authoring', () => {
    const file = readFileSync(
      path.join(REPO_ROOT, '.github/copilot/instructions/product-manager.instructions.md'),
      'utf-8',
    );

    expect(file).toContain('Populate slices as execution blueprints, not summaries.');
    expect(file).toContain('simple surgical tasks should be concise and exact');
    expect(file).toContain('medium tasks need enough file/symbol/test detail to remove ambiguity');
    expect(file).toContain('complex or risky tasks need expanded boundaries, sequencing, contracts, guards, validation, and coordination');
    expect(file).toContain('Complex` uses Dalton fleet/orchestrator mode');
    expect(file).toContain('Do not require every `Complex` slice to be independent or concurrently executable.');
    expect(file).toContain('Do not require every slice to copy every requirement ID.');
    expect(file).toContain('Do not require Dalton to read operator chat, Lily chat, private planning artifacts, or internal planning playbooks.');
    expect(file).not.toMatch(/scratchspace/i);
    expect(file).not.toMatch(/all slices must (run concurrently|be independent)/i);
    expect(file).not.toMatch(/Choose `Complex` only when ALL/i);
    expect(file).not.toMatch(/professional-task\.md/i);
  });

  it('accepts matching generated implementation-spec intake requirements', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-valid-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    const critical = ['- CR-001: Preserve exact operator scope.'];
    const compatibility = ['- COMP-001: Keep existing runtime behavior.'];
    const validation = ['- VAL-001: Run `pnpm run lint`.'];
    writeIntakeRequirementFixture(repoRoot, { critical, compatibility, validation });
    writeMinimalImplementationSpec(repoRoot, generatedIntakeRequirementSpine({ critical, compatibility, validation }));

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations.filter((violation) => (
      violation.rule_id.startsWith('spec.intake-requirements-')
    ))).toEqual([]);
  });

  it('normalizes missing legacy intake requirement sections to None', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-legacy-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    writeIntakeRequirementFixture(repoRoot, { omitRequirementSections: true });
    writeMinimalImplementationSpec(repoRoot, generatedIntakeRequirementSpine());

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations.filter((violation) => (
      violation.rule_id.startsWith('spec.intake-requirements-')
    ))).toEqual([]);
  });

  it('skips generated spine validation when intake is absent', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-absent-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    writeMinimalImplementationSpec(repoRoot, null);

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-slice', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual([]);
  });

  it.each([
    ['spec.intake-requirements-section-present', null],
    [
      'spec.intake-requirements-section-present',
      [
        '## Intake Requirements',
        '',
        '### Required Validation',
        '',
        '- VAL-001: Run `pnpm run lint`.',
        '',
        '### Critical Requirements',
        '',
        '- CR-001: Preserve exact operator scope.',
        '',
        '### Compatibility Requirements',
        '',
        '- COMP-001: Keep existing runtime behavior.',
        '',
      ].join('\n'),
    ],
    [
      'spec.intake-requirements-critical-matches',
      generatedIntakeRequirementSpine({
        critical: ['- CR-001: Summarized instead.'],
        compatibility: ['- COMP-001: Keep existing runtime behavior.'],
        validation: ['- VAL-001: Run `pnpm run lint`.'],
      }),
    ],
    [
      'spec.intake-requirements-compatibility-matches',
      generatedIntakeRequirementSpine({
        critical: ['- CR-001: Preserve exact operator scope.'],
        compatibility: ['- COMP-001: Changed compatibility.'],
        validation: ['- VAL-001: Run `pnpm run lint`.'],
      }),
    ],
    [
      'spec.intake-requirements-validation-matches',
      generatedIntakeRequirementSpine({
        critical: ['- CR-001: Preserve exact operator scope.'],
        compatibility: ['- COMP-001: Keep existing runtime behavior.'],
        validation: ['- VAL-001: Run `pnpm test`.'],
      }),
    ],
  ])('emits %s when the generated spine is missing or edited', async (ruleId, spine) => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-invalid-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    writeIntakeRequirementFixture(repoRoot, {
      critical: ['- CR-001: Preserve exact operator scope.'],
      compatibility: ['- COMP-001: Keep existing runtime behavior.'],
      validation: ['- VAL-001: Run `pnpm run lint`.'],
    });
    writeMinimalImplementationSpec(repoRoot, spine);

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule_id: ruleId }),
    ]));
  });

  it('ignores HTML comments and preserves fenced validation bodies when comparing generated spine content', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-fence-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    const validation = [
      '<!-- generated note -->',
      '- VAL-001: Run this command:',
      '```bash',
      '  pnpm run lint',
      '```',
    ];
    writeIntakeRequirementFixture(repoRoot, {
      critical: ['<!-- ignored -->', '- CR-001: Preserve exact operator scope.'],
      compatibility: ['None'],
      validation,
    });
    writeMinimalImplementationSpec(repoRoot, generatedIntakeRequirementSpine({
      critical: ['- CR-001: Preserve exact operator scope.'],
      compatibility: ['None'],
      validation: validation.slice(1),
    }));

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations.some((violation) => (
      violation.rule_id === 'spec.intake-requirements-validation-matches'
    ))).toBe(false);
  });

  it.each(['pre-slice', 'runtime'] as const)(
    'enforces generated spine integrity in %s without promoting older spec-quality lint rules',
    async (mode) => {
      const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-mode-'));
      createdRoots.push(repoRoot);
      createRegistryFixture(repoRoot);
      createActiveTask(repoRoot);
      writeIntakeRequirementFixture(repoRoot, {
        critical: ['- CR-001: Preserve exact operator scope.'],
      });
      writeMinimalImplementationSpec(repoRoot, generatedIntakeRequirementSpine({
        critical: ['- CR-001: Edited scope.'],
      }));

      const validator = new PolicyValidator({ rootDir: repoRoot, mode, taskId: TEST_TASK_ID });
      await validator.initialize();
      await evaluateSpecQualityRules(validator);

      expect(validator.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'spec.intake-requirements-critical-matches',
          severity: 'error',
        }),
      ]));
      expect(validator.violations.some((violation) => (
        violation.rule_id === 'spec.recommended-section-present'
      ))).toBe(false);
    },
  );

  it('does not enforce generated spine integrity in unrelated workflow-policy modes', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-spine-unrelated-mode-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);
    writeIntakeRequirementFixture(repoRoot, {
      critical: ['- CR-001: Preserve exact operator scope.'],
    });
    writeMinimalImplementationSpec(repoRoot, generatedIntakeRequirementSpine({
      critical: ['- CR-001: Edited scope.'],
    }));

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-closeout', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations.some((violation) => (
      violation.rule_id.startsWith('spec.intake-requirements-')
    ))).toBe(false);
  });

  it('flags intake child-task and routing content gaps with Python-matching rule ids', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createBlankHandoffs(repoRoot);

    writeRepoFile(
      repoRoot,
      'AgentWorkSpace/dropbox/request.md',
      [
        '## Request Summary',
        'Too short.',
        '',
        '## Desired Outcome',
        'Ship it.',
        '',
        '## Acceptance Signals',
        'This should work end to end.',
        '',
        '## Suggested Routing',
        'Use the complex path if needed.',
        '',
        '## Task Lineage',
        '- Task Kind: child-task',
        '- Parent Task ID: parent-123',
        '',
        '## Parent Task Carry-Forward Summary',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateIntakeQualityRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'intake.title-present',
          artifact: 'AgentWorkSpace/dropbox/request.md',
        }),
        expect.objectContaining({
          rule_id: 'intake.routing-recommendation-valid',
          message:
            "Suggested Routing should use the metadata line '- Recommended Execution: simple|complex'.",
        }),
        expect.objectContaining({
          rule_id: 'intake.acceptance-signals-measurable',
        }),
        expect.objectContaining({
          rule_id: 'intake.request-summary-substantive',
        }),
        expect.objectContaining({
          rule_id: 'intake.child-lineage-required',
          message:
            "Task Kind is 'child-task' but required lineage fields are missing: Root Task ID, Follow-Up Reason.",
        }),
        expect.objectContaining({
          rule_id: 'intake.child-carry-forward-required',
        }),
      ]),
    );
  });

  it('accepts Recommended Execution case-insensitively and rejects unrelated values', async () => {
    const acceptedValues = ['simple', 'Simple', 'SIMPLE', 'complex', 'Complex', 'COMPLEX'];

    for (const value of acceptedValues) {
      const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-routing-'));
      createdRoots.push(repoRoot);
      createRegistryFixture(repoRoot);
      createBlankHandoffs(repoRoot);

      writeRepoFile(
        repoRoot,
        'AgentWorkSpace/dropbox/request.md',
        [
          '# Routing request',
          '',
          '## Request Summary',
          'Update routing validation so recommended execution case does not matter.',
          '',
          '## Desired Outcome',
          'The intake validator accepts common casing variants.',
          '',
          '## Acceptance Signals',
          '- Recommended Execution values pass regardless of case.',
          '',
          '## Suggested Routing',
          `- Recommended Execution: ${value}`,
        ].join('\n'),
      );

      const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
      await validator.initialize();
      await evaluateIntakeQualityRules(validator);

      expect(validator.violations).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ rule_id: 'intake.routing-recommendation-valid' }),
        ]),
      );
    }

    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-routing-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createBlankHandoffs(repoRoot);

    writeRepoFile(
      repoRoot,
      'AgentWorkSpace/dropbox/request.md',
      [
        '# Routing request',
        '',
        '## Request Summary',
        'Update routing validation so recommended execution case does not matter.',
        '',
        '## Desired Outcome',
        'The intake validator still rejects unsupported values.',
        '',
        '## Acceptance Signals',
        '- Unsupported Recommended Execution values fail validation.',
        '',
        '## Suggested Routing',
        '- Recommended Execution: medium',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateIntakeQualityRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule_id: 'intake.routing-recommendation-valid' }),
      ]),
    );
  });

  it('accepts canonical requirement sections with shaped IDs', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake([
      '## Critical Requirements',
      '- CR-001: Preserve the exact merge algorithm.',
      '',
      '## Compatibility Requirements',
      '- COMP-001: Existing direct calls keep working.',
      '',
      '## Required Validation',
      '- VAL-001: $ pnpm run lint',
      '',
    ]));

    expect(violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule_id: 'intake.critical-requirements-shaped' }),
        expect.objectContaining({ rule_id: 'intake.compatibility-requirements-shaped' }),
        expect.objectContaining({
          rule_id: 'intake.required-validation-shaped',
          severity: 'error',
        }),
      ]),
    );
  });

  it('accepts exact None in all canonical requirement sections', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake([
      '## Critical Requirements',
      'None',
      '',
      '## Compatibility Requirements',
      'None',
      '',
      '## Required Validation',
      'None',
      '',
    ]));

    expect(violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule_id: 'intake.critical-requirements-shaped' }),
        expect.objectContaining({ rule_id: 'intake.compatibility-requirements-shaped' }),
        expect.objectContaining({ rule_id: 'intake.required-validation-shaped' }),
      ]),
    );
  });

  it.each([
    ['Critical Requirements', 'intake.critical-requirements-shaped', '- Preserve the exact merge algorithm.'],
    ['Compatibility Requirements', 'intake.compatibility-requirements-shaped', '- Existing direct calls keep working.'],
    ['Required Validation', 'intake.required-validation-shaped', '- Run the tests.'],
  ])('rejects non-ID bullets in %s', async (sectionName, ruleId, badBullet) => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);

    const sections = [
      '## Critical Requirements',
      sectionName === 'Critical Requirements' ? badBullet : '- CR-001: Preserve the exact merge algorithm.',
      '',
      '## Compatibility Requirements',
      sectionName === 'Compatibility Requirements' ? badBullet : '- COMP-001: Existing direct calls keep working.',
      '',
      '## Required Validation',
      sectionName === 'Required Validation' ? badBullet : '- VAL-001: $ pnpm run lint',
      '',
    ];

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake(sections));

    expect(violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: ruleId })]),
    );
  });

  it('warns but does not fail on vague required validation items', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake([
      '## Critical Requirements',
      'None',
      '',
      '## Compatibility Requirements',
      'None',
      '',
      '## Required Validation',
      '- VAL-001: Run the tests.',
      '',
    ]));

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'intake.required-validation-shaped',
          severity: 'warning',
        }),
      ]),
    );
    expect(violations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'intake.required-validation-shaped',
          severity: 'error',
        }),
      ]),
    );
  });

  it.each([
    ['- VAL-001: Manual check: confirm the modal shows reviewed status.'],
    ['- VAL-001: Structural check: rg "CR-001" AgentWorkSpace/dropbox'],
    ['- VAL-001: Log snapshot: compare before and after logs.'],
    ['- VAL-001: Run validation.\n```bash\npnpm run lint\n```'],
  ])('accepts concrete required validation evidence: %s', async (validationItem) => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake([
      '## Critical Requirements',
      'None',
      '',
      '## Compatibility Requirements',
      'None',
      '',
      '## Required Validation',
      validationItem,
      '',
    ]));

    expect(violations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: 'intake.required-validation-shaped' })]),
    );
  });

  it.each([
    ['Critical Requirements', 'intake.critical-requirements-shaped', ['- CR-001: First.', '- CR-001: Duplicate.']],
    ['Critical Requirements', 'intake.critical-requirements-shaped', ['- CR-001: First.', '- CR-003: Gap.']],
    ['Critical Requirements', 'intake.critical-requirements-shaped', ['- CR-002: Starts wrong.']],
    ['Compatibility Requirements', 'intake.compatibility-requirements-shaped', ['- COMP-001: First.', '- COMP-001: Duplicate.']],
    ['Compatibility Requirements', 'intake.compatibility-requirements-shaped', ['- COMP-001: First.', '- COMP-003: Gap.']],
    ['Compatibility Requirements', 'intake.compatibility-requirements-shaped', ['- COMP-002: Starts wrong.']],
    ['Required Validation', 'intake.required-validation-shaped', ['- VAL-001: $ pnpm run lint', '- VAL-001: $ pnpm run test']],
    ['Required Validation', 'intake.required-validation-shaped', ['- VAL-001: $ pnpm run lint', '- VAL-003: $ pnpm run test']],
    ['Required Validation', 'intake.required-validation-shaped', ['- VAL-002: $ pnpm run lint']],
  ])('rejects non-sequential IDs in %s', async (sectionName, ruleId, items) => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-intake-requirements-'));
    createdRoots.push(repoRoot);
    const sections = [
      '## Critical Requirements',
      ...(sectionName === 'Critical Requirements' ? items : ['- CR-001: Preserve the exact merge algorithm.']),
      '',
      '## Compatibility Requirements',
      ...(sectionName === 'Compatibility Requirements' ? items : ['- COMP-001: Existing direct calls keep working.']),
      '',
      '## Required Validation',
      ...(sectionName === 'Required Validation' ? items : ['- VAL-001: $ pnpm run lint']),
      '',
    ];

    const violations = await validateIntakeMarkdown(repoRoot, canonicalIntake(sections));

    expect(violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule_id: ruleId })]),
    );
  });

  it('enforces spec structure, executable validation strategy, and child carry-forward parity', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-spec-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot, [
      '- Task Kind: child-task',
      '- Parent Task ID: parent-1',
      '- Root Task ID: root-1',
      '- Parent QMD Record ID: qmd-1',
      '- Parent QMD Scope: workflow-policy',
      '- Follow-Up Reason: split the port into smaller slices',
    ]);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Problem Statement',
        'Port the content rules.',
        '',
        '## Goals',
        'Preserve parity.',
        '',
        '## Non-Goals',
        '- No queue/runtime cutover.',
        '',
        '## Architecture Summary',
        'Use the workflow-policy foundation.',
        '',
        '## Touched Systems',
        '- workflow-policy',
        '',
        '## Change Boundaries',
        'Rules and tests only.',
        '',
        '## Dependency Analysis',
        'Depends on the current validator foundation.',
        '',
        '## Codebase Analysis',
        'The content rules already live under rules/*.ts.',
        '',
        '## Proposed Structure',
        'Keep one file per rule family.',
        '',
        '## Validation Strategy',
        'Run the relevant tests before handoff.',
        '',
        '## Files or Areas Likely to Change',
        '- src/backend/platform/workflow-policy/rules/',
        '',
        '## Parent Task Carry-Forward Context',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'spec.validation-strategy-executable',
        }),
        expect.objectContaining({
          rule_id: 'spec.dependency-analysis-structured',
        }),
        expect.objectContaining({
          rule_id: 'spec.child-carry-forward-required',
        }),
      ]),
    );
  });

  it('accepts grouped implementation-spec sections authored from the current template scaffold', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-grouped-spec-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '',
        '### Core Metadata',
        '',
        '- Task ID: task-123',
        '- Task Title: Workflow policy parity',
        '',
        '### Task Lineage',
        '',
        '- Task Kind: standard',
        '',
        '## Problem and Outcome',
        '',
        '### Problem Statement',
        'Port the content rules.',
        '',
        '### Goals',
        '- Preserve parity.',
        '',
        '### Non-Goals',
        '- No queue/runtime cutover.',
        '',
        '## Current State and Boundaries',
        '',
        '### Parent Task Carry-Forward Context',
        '',
        '### Codebase Analysis',
        'The content rules already live under rules/*.ts.',
        '',
        '### Source Inventory',
        '- slice-1 owns the change.',
        '',
        '### Dependency Analysis',
        '| Module | Depends On |',
        '|---|---|',
        '| spec.ts | artifacts.ts |',
        '',
        '### Change Boundaries',
        'Rules and tests only.',
        '',
        '## Implementation Plan',
        '',
        '### Architecture Summary',
        'Use the workflow-policy foundation.',
        '',
        '### Touched Systems',
        '- workflow-policy',
        '',
        '### Proposed Structure',
        'Keep one file per rule family.',
        '',
        '### Slice Partition',
        '- slice-1 owns the change.',
        '',
        '### Contracts',
        'None.',
        '',
        '### Migrations or Data Implications',
        'None.',
        '',
        '## Risk and Impact',
        '',
        '### Risks',
        '- Low.',
        '',
        '### Impact Assessment',
        'Low risk, additive change.',
        '',
        '## Validation and Evidence',
        '',
        '### Validation Strategy',
        '```bash',
        'pnpm exec vitest run --config src/backend/platform/vitest.config.ts src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '```',
        '',
        '### Test Coverage',
        'src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '',
        '## Change Surface',
        '',
        '### Files or Areas Likely to Change',
        '- src/backend/platform/workflow-policy/',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual([]);
  });

  it('accepts a legacy flat-heading implementation-spec end to end', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-legacy-spec-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '- Task Title: Workflow policy parity',
        '',
        '## Task Lineage',
        '- Task Kind: standard',
        '',
        '## Problem Statement',
        'Port the content rules.',
        '',
        '## Goals',
        '- Preserve parity.',
        '',
        '## Non-Goals',
        '- No queue/runtime cutover.',
        '',
        '## Architecture Summary',
        'Use the workflow-policy foundation.',
        '',
        '## Touched Systems',
        '- workflow-policy',
        '',
        '## Change Boundaries',
        'Rules and tests only.',
        '',
        '## Dependency Analysis',
        '| Module | Depends On |',
        '|---|---|',
        '| spec.ts | artifacts.ts |',
        '',
        '## Codebase Analysis',
        'The content rules already live under rules/*.ts.',
        '',
        '## Source Inventory',
        '- slice-1 owns the change.',
        '',
        '## Proposed Structure',
        'Keep one file per rule family.',
        '',
        '## Slice Partition',
        '- slice-1 owns the change.',
        '',
        '## Contracts',
        'None.',
        '',
        '## Migrations or Data Implications',
        'None.',
        '',
        '## Risks',
        '- Low.',
        '',
        '## Validation Strategy',
        '```bash',
        'pnpm exec vitest run --config src/backend/platform/vitest.config.ts src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '```',
        '',
        '## Test Coverage',
        'src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '',
        '## Impact Assessment',
        'Low risk, additive change.',
        '',
        '## Files or Areas Likely to Change',
        '- src/backend/platform/workflow-policy/',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual([]);
  });

  it('accepts a lean grouped implementation-spec with only the minimum required content', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-lean-spec-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '',
        '### Core Metadata',
        '',
        '- Task ID: task-123',
        '',
        '## Problem and Outcome',
        '',
        '### Problem Statement',
        'Need semantic validation.',
        '',
        '### Goals',
        '- Keep the current workflow intact.',
        '',
        '### Non-Goals',
        '- No queue redesign.',
        '',
        '## Current State and Boundaries',
        '',
        '### Parent Task Carry-Forward Context',
        '',
        '### Codebase Analysis',
        'Rules already live under workflow-policy.',
        '',
        '### Source Inventory',
        '- slice-1 owns the change.',
        '',
        '### Dependency Analysis',
        '| Module | Depends On |',
        '|---|---|',
        '| spec.ts | artifacts.ts |',
        '',
        '### Change Boundaries',
        'Validation logic only.',
        '',
        '## Implementation Plan',
        '',
        '### Architecture Summary',
        'Use semantic slot resolution.',
        '',
        '### Touched Systems',
        '- workflow-policy',
        '',
        '### Proposed Structure',
        'Retain grouped sections.',
        '',
        '### Slice Partition',
        '- slice-1 owns the change.',
        '',
        '## Validation and Evidence',
        '',
        '### Validation Strategy',
        '```bash',
        'pnpm exec vitest run --config src/backend/platform/vitest.config.ts src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '```',
        '',
        '## Change Surface',
        '',
        '### Files or Areas Likely to Change',
        '- src/backend/platform/workflow-policy/',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSpecQualityRules(validator);

    expect(validator.violations).toEqual([
      expect.objectContaining({
        rule_id: 'spec.recommended-section-present',
        severity: 'warning',
        message: "Recommended section 'Risks' is missing or empty.",
      }),
      expect.objectContaining({
        rule_id: 'spec.recommended-section-present',
        severity: 'warning',
        message: "Recommended section 'Impact Assessment' is missing or empty.",
      }),
    ]);
  });

  it('checks child-task lineage completeness and lineage consistency across handoffs', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-task-quality-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot, [
      '- Task Kind: child-task',
      '- Parent Task ID: parent-1',
      '- Root Task ID: root-1',
    ]);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Task Lineage',
        '- Parent Task ID: parent-2',
        '- Root Task ID: root-1',
        '',
        '## Problem Statement',
        'Still substantive so lineage consistency runs.',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateTaskQualityRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'task.child-lineage-required',
          message:
            "Task Kind is 'child-task' but required lineage fields are missing: Parent QMD Record ID, Parent QMD Scope, Follow-Up Reason.",
        }),
        expect.objectContaining({
          rule_id: 'task.child-carry-forward-required',
        }),
        expect.objectContaining({
          rule_id: 'task.lineage-consistency',
          artifact: 'implementation-spec.md',
          message:
            "Lineage field 'Parent Task ID' is 'parent-2' in implementation-spec.md but 'parent-1' in professional-task.md.",
        }),
      ]),
    );
  });

  it('enforces slice file scope, measurable acceptance criteria, and executable validation commands', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-slice-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createBlankHandoffs(repoRoot);

    writeRepoFile(
      repoRoot,
      `AgentWorkSpace/tasks/${TEST_TASK_ID}/ImplementationSteps/content-slice.md`,
      [
        '# Content Slice',
        '',
        '## Purpose',
        'Port content rules.',
        '',
        '## Depends On',
        '- core-foundation',
        '',
        '## Scope',
        'workflow-policy content family only',
        '',
        '## Files',
        '',
        '## Acceptance Criteria',
        'Everything should be good.',
        '',
        '## Unit Tests',
        '- Add representative parity tests.',
        '',
        '## Validation Commands',
        'Run the normal checks.',
        '',
        '## Guards',
        '- Do not touch runtime callers.',
        '',
      ].join('\n'),
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-slice', taskId: TEST_TASK_ID });
    await validator.initialize();
    await evaluateSliceQualityRules(validator);

    expect(validator.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule_id: 'slice.required-section-present',
          artifact: `AgentWorkSpace/tasks/${TEST_TASK_ID}/ImplementationSteps/content-slice.md`,
          message: "Required section 'Files' is missing or empty.",
        }),
        expect.objectContaining({
          rule_id: 'slice.file-scope-declared',
        }),
        expect.objectContaining({
          rule_id: 'slice.validation-commands-executable',
        }),
      ]),
    );
  });

  it('accepts semantic aliases for implementation specs and grouped slice sections', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-semantic-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createActiveTask(repoRoot);

    writeRepoFile(
      repoRoot,
      path.relative(repoRoot, path.join(resolvePaths({ repoRoot, taskId: TEST_TASK_ID }).handoffs, 'implementation-spec.md')),
      [
        '# Implementation Spec',
        '',
        '## Task Metadata',
        '- Task ID: task-123',
        '',
        '## Problem and Outcome',
        'Port semantic-slot validation without changing the workflow.',
        '',
        '- Preserve legacy compatibility.',
        '- Allow semantic aliases.',
        '',
        '## Current State and Boundaries',
        '| Dependency | Reason |',
        '| --- | --- |',
        '| workflow-policy | validators and templates |',
        '',
        '- No queue lifecycle changes.',
        'The current validator still keys legacy headings directly.',
        '- workflow-policy',
        '',
        '### Source Inventory',
        '- slice-1 owns the change.',
        '',
        '## Implementation Plan',
        'Keep the existing rule families and add shared slot resolution.',
        '',
        '### Slice Partition',
        '- slice-1 owns the change.',
        '',
        '## Risk and Impact',
        'Low-risk policy refactor with validator-only impact.',
        '',
        '## Validation and Evidence',
        '```bash',
        'pnpm test -- --run src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '```',
        '',
        '## Change Surface',
        '- src/backend/platform/workflow-policy/models.ts',
        '- src/backend/platform/workflow-policy/rules/spec.ts',
        '',
      ].join('\n'),
    );

    writeRepoFile(
      repoRoot,
      `AgentWorkSpace/tasks/${TEST_TASK_ID}/ImplementationSteps/content-slice.md`,
      [
        '# Content Slice',
        '',
        '## Objective',
        'Implement semantic slot lookup for workflow-policy.',
        '',
        '## Dependencies and Order',
        '- implementation-spec.md is complete first.',
        '',
        '## Execution Scope',
        'workflow-policy validators and helpers only.',
        '',
        '## Files and Interfaces',
        '- src/backend/platform/workflow-policy/artifacts.ts',
        '',
        '## Acceptance and Validation',
        '### Acceptance Criteria',
        '- Legacy and grouped headings both pass.',
        '',
        '### Unit Tests',
        '- Add targeted workflow-policy coverage.',
        '',
        '### Validation Commands',
        '```bash',
        'pnpm test -- --run src/backend/platform/workflow-policy/__tests__/contentRuleFamilies.test.ts',
        '```',
        '',
        '## Guards and Coordination',
        '- Keep slices authoritative.',
        '',
      ].join('\n'),
    );

    const specValidator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await specValidator.initialize();
    await evaluateSpecQualityRules(specValidator);
    expect(specValidator.violations).toEqual([]);

    const sliceValidator = new PolicyValidator({ rootDir: repoRoot, mode: 'pre-slice', taskId: TEST_TASK_ID });
    await sliceValidator.initialize();
    await evaluateSliceQualityRules(sliceValidator);
    expect(sliceValidator.violations).toEqual([]);
  });
});
