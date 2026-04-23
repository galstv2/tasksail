/**
 * Tests for Deliverable 4: TypeScript workflow rule evaluation.
 *
 * Tests cover:
 *   1. Evaluation order by mode (full vs lightweight)
 *   2. Representative rule family activation / parity cases
 *   3. createDefaultRuleEvaluators() wiring
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FULL_EVALUATION_SEQUENCE,
  LIGHTWEIGHT_EVALUATION_SEQUENCE,
  PolicyValidator,
  createDefaultRuleEvaluators,
} from '../index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_TASK_ID = 'task-test-001';

function makeRepoRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'ts-rules-'));
  return root;
}

function writeRegistry(repoRoot: string): void {
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
    'utf-8',
  );
}

function writeHandoffsReset(repoRoot: string): void {
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });
  for (const fileName of [
    'professional-task.md',
    'implementation-spec.md',
    'retrospective-input.md',
    'final-summary.md',
    'issues.md',
  ]) {
    writeFileSync(path.join(handoffsDir, fileName), '', 'utf-8');
  }
}

function writeActiveTask(repoRoot: string): void {
  writeHandoffsReset(repoRoot);
  writeFileSync(
    path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'professional-task.md'),
    [
      '## Task Metadata',
      '- Task ID: task-42',
      '- Task Title: Test task',
      '',
      '## Problem Statement',
      'Implement the feature.',
      '',
      '## Business Goal',
      'Deliver value.',
      '',
      '## Scope',
      'Backend only.',
      '',
      '## Non-Goals',
      '- No UI changes.',
      '',
      '## Acceptance Criteria',
      '- Tests pass.',
      '',
    ].join('\n'),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Evaluation order tests
// ---------------------------------------------------------------------------

describe('createDefaultRuleEvaluators()', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('full evaluation sequence fires in Python-compatible order for runtime mode', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const fired: string[] = [];
    const trackingEvaluators = Object.fromEntries(
      FULL_EVALUATION_SEQUENCE.map((name) => [name, () => void fired.push(name)]),
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      ruleEvaluators: trackingEvaluators,
    });

    await validator.evaluate();

    expect(fired).toEqual([...FULL_EVALUATION_SEQUENCE]);
  });

  it('full evaluation sequence fires for lint mode', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const fired: string[] = [];
    const trackingEvaluators = Object.fromEntries(
      FULL_EVALUATION_SEQUENCE.map((name) => [name, () => void fired.push(name)]),
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: trackingEvaluators,
    });

    await validator.evaluate();
    expect(fired).toEqual([...FULL_EVALUATION_SEQUENCE]);
  });

  it('lightweight sequence fires for pre-closeout', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const fired: string[] = [];
    const allTracking = Object.fromEntries(
      [...FULL_EVALUATION_SEQUENCE, ...LIGHTWEIGHT_EVALUATION_SEQUENCE].map((n) => [
        n,
        () => void fired.push(n),
      ]),
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: allTracking,
    });

    await validator.evaluate();
    expect(fired).toEqual([...LIGHTWEIGHT_EVALUATION_SEQUENCE]);
  });

  it('lightweight sequence fires for queue-advance', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const fired: string[] = [];
    const allTracking = Object.fromEntries(
      [...FULL_EVALUATION_SEQUENCE, ...LIGHTWEIGHT_EVALUATION_SEQUENCE].map((n) => [
        n,
        () => void fired.push(n),
      ]),
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'queue-advance',
      taskId: TEST_TASK_ID,
      ruleEvaluators: allTracking,
    });

    await validator.evaluate();
    expect(fired).toEqual([...LIGHTWEIGHT_EVALUATION_SEQUENCE]);
  });

  it('createDefaultRuleEvaluators returns all rule names from the full sequence', () => {
    const registry = createDefaultRuleEvaluators();
    for (const name of FULL_EVALUATION_SEQUENCE) {
      expect(registry).toHaveProperty(name);
      expect(typeof registry[name]).toBe('function');
    }
  });

  it('createDefaultRuleEvaluators returns all lightweight rule names', () => {
    const registry = createDefaultRuleEvaluators();
    for (const name of LIGHTWEIGHT_EVALUATION_SEQUENCE) {
      expect(registry).toHaveProperty(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Representative rule family parity tests
// ---------------------------------------------------------------------------

describe('boundary rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('fires no boundary violations on a clean reset workspace', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    const boundaryViolations = result.violations.filter((v) =>
      v.rule_id.startsWith('boundary.'),
    );
    expect(boundaryViolations).toHaveLength(0);
  });

  it('reports task-id-consistency violation when handoffs disagree on Task ID', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'professional-task.md'),
      '## Task Metadata\n- Task ID: task-A\n## Problem Statement\nABC\n',
      'utf-8',
    );
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'final-summary.md'),
      '## Task Metadata\n- Task ID: task-B\n## Completed Work\nDone\n',
      'utf-8',
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    expect(result.violations.some((v) => v.rule_id === 'boundary.task-id-consistency')).toBe(true);
  });
});

describe('required task artifact rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('fires artifact.active-task-metadata when task ID is missing', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'professional-task.md'),
      '## Task Metadata\n- Task Title: My Task\n## Problem Statement\nABC\n',
      'utf-8',
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    expect(result.violations.some((v) => v.rule_id === 'artifact.active-task-metadata')).toBe(true);
  });
});

describe('closeout rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('pre-closeout requires issues.md to exist', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);

    // Manually create workspace WITHOUT issues.md
    const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(
      path.join(handoffsDir, 'professional-task.md'),
      '## Task Metadata\n- Task ID: task-42\n- Task Title: T\n## Problem Statement\nA\n',
      'utf-8',
    );
    for (const f of ['implementation-spec.md', 'retrospective-input.md', 'final-summary.md']) {
      writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
    }
    // issues.md is NOT created

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    // Should fail with closeout.qa-review-approved because issues.md doesn't exist
    expect(result.violations.some((v) => v.rule_id === 'closeout.qa-review-approved')).toBe(true);
  });

  it('pre-closeout requires final-summary.md to be complete', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    // Write issues.md with passing review
    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'issues.md'),
      '## Review Outcome\npass\n',
      'utf-8',
    );
    // final-summary.md remains blank

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'pre-closeout',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    expect(result.violations.some((v) => v.rule_id === 'closeout.final-summary-required')).toBe(true);
  });
});

describe('queue rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('queue-advance on empty workspace returns ok', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);
    // No active-items/ marker, no pending items.
    // §4.1B: taskId is required for queue-advance mode so the rule can check activeItemsDir.

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'queue-advance',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    const queueViolations = result.violations.filter((v) => v.rule_id.startsWith('queue.'));
    expect(queueViolations).toHaveLength(0);
  });
});

describe('workflow path rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('lint mode reports missing implementation-spec', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);
    // implementation-spec.md is blank (already written by writeActiveTask)

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'lint',
      taskId: TEST_TASK_ID,
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    expect(
      result.violations.some((v) => v.rule_id === 'path.standard-requires-implementation-spec'),
    ).toBe(true);
  });
});

describe('planning agent rules — parity', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('warns when planning-agent is requested with active task', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
      requestedAgentId: 'planning-agent',
      ruleEvaluators: createDefaultRuleEvaluators(),
    });

    const result = await validator.evaluate();
    expect(
      result.violations.some((v) => v.rule_id === 'runtime.planning-agent-pre-task-only'),
    ).toBe(true);
    // Should be a warning, not an error
    const violation = result.violations.find(
      (v) => v.rule_id === 'runtime.planning-agent-pre-task-only',
    );
    expect(violation?.severity).toBe('warning');
  });
});

describe('retrospectiveContributionSections() ordering', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('returns contribution sections in workflow_order', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeActiveTask(repoRoot);

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      mode: 'runtime',
      taskId: TEST_TASK_ID,
    });
    await validator.initialize();

    const sections = validator.retrospectiveContributionSections();
    // The registry has workflow_order 0=Lily, 1=Alice, 2=Dalton, 3=Ron
    expect(sections.map(([, s]) => s)).toEqual([
      "Lily's Contribution (Planning Specialist)",
      "Alice's Contribution (Product Manager)",
      "Dalton's Contribution (Software Engineer)",
      "Ron's Contribution (QA and Closeout)",
    ]);
  });
});

describe('isFullRetrospectiveRequired()', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('returns true by default when no retro artifact exists', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();

    expect(validator.isFullRetrospectiveRequired()).toBe(true);
  });

  it('returns false when retrospective-input.md has Retrospective Required: false', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'retrospective-input.md'),
      '## Task Metadata\n- Retrospective Required: false\n',
      'utf-8',
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();

    expect(validator.isFullRetrospectiveRequired()).toBe(false);
  });
});

describe('retrospectiveCompletionGaps()', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  it('returns missing artifact gap when retro does not exist', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);

    // Create workspace WITHOUT retrospective-input.md
    const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    for (const f of ['professional-task.md', 'implementation-spec.md', 'final-summary.md', 'issues.md']) {
      writeFileSync(path.join(handoffsDir, f), '', 'utf-8');
    }
    // retrospective-input.md is deliberately absent

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();

    const gaps = validator.retrospectiveCompletionGaps(true);
    expect(gaps.required_sections).toContain('retrospective artifact is missing');
  });

  it('returns action_items gap when Action Items is empty', async () => {
    const repoRoot = makeRepoRoot();
    roots.push(repoRoot);
    writeRegistry(repoRoot);
    writeHandoffsReset(repoRoot);

    writeFileSync(
      path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs', 'retrospective-input.md'),
      [
        '## Task Metadata',
        '- Retrospective Required: true',
        '',
        '## Retrospective Summary',
        'Summary content.',
        '',
        '## What Went Well',
        'Good stuff.',
        '',
        '## What Could Have Gone Better',
        'Bad stuff.',
        '',
        '## Action Items',
        '<!-- empty -->',
        '',
      ].join('\n'),
      'utf-8',
    );

    const validator = new PolicyValidator({ rootDir: repoRoot, mode: 'lint', taskId: TEST_TASK_ID });
    await validator.initialize();

    const gaps = validator.retrospectiveCompletionGaps(true);
    expect(gaps.action_items.length).toBeGreaterThan(0);
    expect(gaps.action_items[0]).toMatch(/at least one bullet/i);
  });
});
