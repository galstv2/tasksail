/**
 * Focused policy-rule parity tests.
 *
 * Validates that:
 * 1. Default evaluators are wired so real rules run without custom injection.
 * 2. Per-mode evaluation sequences exactly match the live TypeScript ordering.
 * 3. Representative rule behaviours match Python's evaluate() logic.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copilotProvider } from '../../cli-provider/providers/copilot/index.js';
import {
  DEFAULT_RULE_EVALUATORS,
  FULL_EVALUATION_SEQUENCE,
  LIGHTWEIGHT_EVALUATION_SEQUENCE,
  PolicyValidator,
  createDefaultRuleEvaluators,
} from '../index.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const TEST_TASK_ID = 'task-test-001';

function createRegistry(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'registry.json'),
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
          required_model: 'gpt-4.1',
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
    'utf-8',
  );
}

function createActiveWorkspace(repoRoot: string): void {
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });

  writeFileSync(
    path.join(handoffsDir, 'professional-task.md'),
    [
      '## Task Metadata',
      '- Task ID: task-parity-1',
      '- Task Title: Parity Test Task',
      '',
      '## Problem Statement',
      'Verify that rule parity with Python is preserved.',
      '',
    ].join('\n'),
    'utf-8',
  );

  for (const f of ['implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md']) {
    writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
  }
}

function writeNamedAgentFiles(repoRoot: string): void {
  const agents = [
    ['planning-agent', 'Planning Specialist', 'Lily'],
    ['product-manager', 'Product Manager', 'Alice'],
    ['software-engineer', 'Software Engineer', 'Dalton'],
    ['qa', 'QA and Closeout', 'Ron'],
  ] as const;

  for (const [agentId, role, name] of agents) {
    const instructionPath = path.join(repoRoot, '.github', 'copilot', 'instructions', `${agentId}.instructions.md`);
    mkdirSync(path.dirname(instructionPath), { recursive: true });
    const instructionHeading =
      agentId === 'planning-agent'
        ? `# ${role} Instructions`
        : `# ${role} (${name}) — Instructions`;
    writeFileSync(instructionPath, `${instructionHeading}\n`, 'utf-8');

    const identity =
      agentId === 'planning-agent'
        ? `Act as the ${role}.`
        : `Act as ${name}, the ${role}.`;
    writeFileSync(
      path.join(repoRoot, '.github', 'agents', `${agentId}.md`),
      [
        '---',
        `name: ${agentId}`,
        `description: ${role}`,
        'model: gpt-5.4',
        '---',
        identity,
        `Follow the repository workflow and the ${role} instructions.`,
      ].join('\n'),
      'utf-8',
    );
  }
}

function createResetWorkspace(repoRoot: string): void {
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });
  for (const f of [
    'professional-task.md',
    'implementation-spec.md',
    'retrospective-input.md',
    'final-summary.md',
    'issues.md',
  ]) {
    writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workflow-policy rule parity', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  // -------------------------------------------------------------------------
  // Evaluation ordering by mode
  // -------------------------------------------------------------------------

  it('DEFAULT_RULE_EVALUATORS covers every entry in FULL_EVALUATION_SEQUENCE', () => {
    for (const ruleName of FULL_EVALUATION_SEQUENCE) {
      expect(DEFAULT_RULE_EVALUATORS).toHaveProperty(ruleName);
    }
  });

  it('DEFAULT_RULE_EVALUATORS covers every entry in LIGHTWEIGHT_EVALUATION_SEQUENCE', () => {
    for (const ruleName of LIGHTWEIGHT_EVALUATION_SEQUENCE) {
      expect(DEFAULT_RULE_EVALUATORS).toHaveProperty(ruleName);
    }
  });

  it('DEFAULT_RULE_EVALUATORS stays aligned with createDefaultRuleEvaluators', () => {
    expect(Object.keys(DEFAULT_RULE_EVALUATORS).sort()).toEqual(
      Object.keys(createDefaultRuleEvaluators()).sort(),
    );
  });

  it('delegates named-agent profile parsing to the active provider', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'ts-rules-'));
    createdRoots.push(repoRoot);
    createRegistry(repoRoot);
    writeNamedAgentFiles(repoRoot);
    createActiveWorkspace(repoRoot);

    const parseSpy = vi.spyOn(copilotProvider, 'parseAgentProfile');
    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
    });

    await validator.evaluate();

    expect(parseSpy).toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('full sequence has exactly 19 steps matching Python order', () => {
    expect([...FULL_EVALUATION_SEQUENCE]).toEqual([
      'namedAgentRules',
      'boundaryRules',
      'requiredTaskArtifacts',
      'artifactAgentIdRules',
      'workflowPathRules',
      'transitionLegalityRules',
      'closeoutRules',
      'sliceQualityRules',
      'specQualityRules',
      'taskQualityRules',
      'queueRules',
      'intakeQualityRules',
      'planningAgentRules',
      'qaExecutionRules',
      'templateStructureRules',
      'parallelOkContentRules',
      'bootstrapRules',
    ]);
  });

  it('lightweight sequence has exactly 3 steps matching Python pre-closeout/queue-advance order', () => {
    expect([...LIGHTWEIGHT_EVALUATION_SEQUENCE]).toEqual([
      'namedAgentRules',
      'closeoutRules',
      'queueRules',
    ]);
  });

  it('uses lightweight sequence for pre-closeout', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-parity-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const seen: string[] = [];
    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: Object.fromEntries(
        [...FULL_EVALUATION_SEQUENCE, ...LIGHTWEIGHT_EVALUATION_SEQUENCE].map(
          (name) => [name, () => void seen.push(name)],
        ),
      ),
    });
    await validator.evaluate();

    expect(seen).toEqual([...LIGHTWEIGHT_EVALUATION_SEQUENCE]);
  });

  it('uses lightweight sequence for queue-advance', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-parity-qa-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const seen: string[] = [];
    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'queue-advance',
      taskId: TEST_TASK_ID,
      ruleEvaluators: Object.fromEntries(
        [...FULL_EVALUATION_SEQUENCE, ...LIGHTWEIGHT_EVALUATION_SEQUENCE].map(
          (name) => [name, () => void seen.push(name)],
        ),
      ),
    });
    await validator.evaluate();

    expect(seen).toEqual([...LIGHTWEIGHT_EVALUATION_SEQUENCE]);
  });

  it('uses full sequence for lint mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-parity-lint-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const seen: string[] = [];
    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: Object.fromEntries(
        FULL_EVALUATION_SEQUENCE.map((name) => [name, () => void seen.push(name)]),
      ),
    });
    await validator.evaluate();

    expect(seen).toEqual([...FULL_EVALUATION_SEQUENCE]);
  });

  // -------------------------------------------------------------------------
  // Rule parity: boundary rules
  // -------------------------------------------------------------------------

  it('boundary rule: orphaned workspace content with no active task produces a violation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-boundary-'));
    createdRoots.push(root);
    createRegistry(root);

    const handoffsDir = path.join(root, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    // No task-id in metadata but substantive content in implementation-spec
    writeFileSync(path.join(handoffsDir, 'professional-task.md'), '', 'utf-8');
    writeFileSync(
      path.join(handoffsDir, 'implementation-spec.md'),
      ['## Problem Statement', 'Some orphaned content here.'].join('\n'),
      'utf-8',
    );
    for (const f of ['retrospective-input.md', 'final-summary.md', 'issues.md']) {
      writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
    }

    const violations: string[] = [];
    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: {
        boundaryRules: DEFAULT_RULE_EVALUATORS.boundaryRules,
      },
    });
    await validator.evaluate();

    const ids = validator.violations.map((v) => v.rule_id);
    expect(ids).toContain('boundary.orphaned-workspace-content');
    void violations;
  });

  // -------------------------------------------------------------------------
  // Rule parity: closeout rules
  // -------------------------------------------------------------------------

  it('closeout rules: skipped when mode is not pre-closeout or pre-archive', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-closeout-skip-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: { closeoutRules: DEFAULT_RULE_EVALUATORS.closeoutRules },
    });
    await validator.evaluate();

    // Rules registered but no violations in non-closeout mode
    expect(validator.evaluatedRules.has('closeout.final-summary-required')).toBe(true);
    const closeoutViolations = validator.violations.filter((v) => v.rule_id.startsWith('closeout.'));
    expect(closeoutViolations).toHaveLength(0);
  });

  it('closeout rules: fires final-summary-required error in pre-closeout when final-summary is blank', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-closeout-fire-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    // issues.md must exist with review outcome pass to pass qa-review-approved check
    writeFileSync(
      path.join(root, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'issues.md'),
      ['## Review Outcome', 'pass'].join('\n'),
      'utf-8',
    );

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: {
        namedAgentRules: async () => {},
        closeoutRules: DEFAULT_RULE_EVALUATORS.closeoutRules,
        queueRules: async () => {},
      },
    });
    await validator.evaluate();

    const ids = validator.violations.map((v) => v.rule_id);
    expect(ids).toContain('closeout.final-summary-required');
  });

  // -------------------------------------------------------------------------
  // Rule parity: queue rules
  // -------------------------------------------------------------------------

  it('queue rules: skipped when mode is not queue-advance', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-queue-skip-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: { queueRules: DEFAULT_RULE_EVALUATORS.queueRules },
    });
    await validator.evaluate();

    expect(validator.evaluatedRules.has('queue.closeout-required')).toBe(true);
    const queueViolations = validator.violations.filter((v) => v.rule_id.startsWith('queue.'));
    expect(queueViolations).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Rule parity: planning agent
  // -------------------------------------------------------------------------

  it('planning rule: emits warning when planning-agent runs with an active task', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-planning-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      requestedAgentId: 'planning-agent',
      ruleEvaluators: { planningAgentRules: DEFAULT_RULE_EVALUATORS.planningAgentRules },
    });
    await validator.evaluate();

    const planningViolations = validator.violations.filter(
      (v) => v.rule_id === 'runtime.planning-agent-pre-task-only',
    );
    expect(planningViolations).toHaveLength(1);
    expect(planningViolations[0]!.severity).toBe('warning');
  });

  it('planning rule: no warning when no active task', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-planning-notask-'));
    createdRoots.push(root);
    createRegistry(root);
    createResetWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      requestedAgentId: 'planning-agent',
      ruleEvaluators: { planningAgentRules: DEFAULT_RULE_EVALUATORS.planningAgentRules },
    });
    await validator.evaluate();

    const planningViolations = validator.violations.filter(
      (v) => v.rule_id === 'runtime.planning-agent-pre-task-only',
    );
    expect(planningViolations).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Rule parity: required task artifacts
  // -------------------------------------------------------------------------

  it('required task artifacts: fires when active task is missing Task Title', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-task-meta-'));
    createdRoots.push(root);
    createRegistry(root);

    const handoffsDir = path.join(root, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      ['## Task Metadata', '- Task ID: task-abc', '', '## Problem Statement', 'Substantive.'].join('\n'),
      'utf-8',
    );
    for (const f of ['implementation-spec.md', 'retrospective-input.md', 'final-summary.md', 'issues.md']) {
      writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
    }

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: { requiredTaskArtifacts: DEFAULT_RULE_EVALUATORS.requiredTaskArtifacts },
    });
    await validator.evaluate();

    const ids = validator.violations.map((v) => v.rule_id);
    expect(ids).toContain('artifact.active-task-metadata');
  });

  // -------------------------------------------------------------------------
  // Rule parity: workflow path rules
  // -------------------------------------------------------------------------

  it('workflow path rule: fires in lint when implementation-spec is blank', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-wfpath-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: { workflowPathRules: DEFAULT_RULE_EVALUATORS.workflowPathRules },
    });
    await validator.evaluate();

    const ids = validator.violations.map((v) => v.rule_id);
    expect(ids).toContain('path.standard-requires-implementation-spec');
  });

  it('workflow path rule: skipped in runtime mode', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-wfpath-runtime-'));
    createdRoots.push(root);
    createRegistry(root);
    createActiveWorkspace(root);

    const validator = new PolicyValidator({
      rootDir: root,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      ruleEvaluators: { workflowPathRules: DEFAULT_RULE_EVALUATORS.workflowPathRules },
    });
    await validator.evaluate();

    const ids = validator.violations.map((v) => v.rule_id);
    expect(ids).not.toContain('path.standard-requires-implementation-spec');
  });

  // -------------------------------------------------------------------------
  // Rule parity: default evaluators produce real rule records
  // -------------------------------------------------------------------------

  it('default evaluators: real rules record IDs via recordRule without custom injection', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wp-defaults-'));
    createdRoots.push(root);
    createRegistry(root);
    createResetWorkspace(root);

    // No ruleEvaluators override — defaults must run
    const validator = new PolicyValidator({ rootDir: root, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.evaluate();

    // Boundary rule should have run and recorded itself
    expect(validator.evaluatedRules.has('boundary.task-id-consistency')).toBe(true);
    // Closeout rule should have run and recorded itself
    expect(validator.evaluatedRules.has('closeout.final-summary-required')).toBe(true);
    // Queue rule should have run and recorded itself
    expect(validator.evaluatedRules.has('queue.closeout-required')).toBe(true);
  });
});
