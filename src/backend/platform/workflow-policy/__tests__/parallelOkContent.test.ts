/**
 * Focused tests for parallel-ok content validation rules.
 *
 * Covers markdown parity (existing behavior) and XML format awareness
 * (independent slices accept bare slice-N and slice-N.xml in xml mode).
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../core/index.js';
import { PolicyValidator } from '../index.js';
import { evaluateParallelOkContentRules } from '../rules/parallelOkContent.js';

const TEST_TASK_ID = 'task-test-001';

function writeFile(dir: string, name: string, content: string): void {
  const fullPath = path.join(dir, name);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf-8');
}

function createRegistry(repoRoot: string): void {
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
      ],
    }, null, 2),
    'utf-8',
  );
}

function createWorkspace(repoRoot: string): void {
  createRegistry(repoRoot);
  const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
  mkdirSync(handoffs, { recursive: true });
  mkdirSync(implementationSteps, { recursive: true });
  writeFileSync(
    path.join(handoffs, 'professional-task.md'),
    '# Task\n\n## Task Metadata\n- Task ID: task-test-001\n',
    'utf-8',
  );
  for (const f of ['retrospective-input.md', 'final-summary.md', 'issues.md']) {
    writeFileSync(path.join(handoffs, f), '', 'utf-8');
  }
}

function writeTaskJson(repoRoot: string, sliceArtifactFormat: 'markdown' | 'xml'): void {
  const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    path.join(taskDir, '.task.json'),
    JSON.stringify({
      schema_version: 2,
      taskId: TEST_TASK_ID,
      title: 'Test Task',
      state: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      finalizedAt: null,
      sliceArtifactFormat,
      contextPackBinding: {
        contextPackPath: null,
        dataHostDir: null,
        dataContainerDir: null,
        repoBindings: [],
      },
      bindings: [],
      materialization: { strategy: 'copy', cloned: [], skipped: [] },
    }),
    'utf-8',
  );
}

async function runParallelOkRules(
  repoRoot: string,
  mode: 'pre-slice' | 'lint' | 'ci' = 'pre-slice',
) {
  const validator = new PolicyValidator({ rootDir: repoRoot, mode, taskId: TEST_TASK_ID });
  await validator.initialize();
  await evaluateParallelOkContentRules(validator);
  return validator.violations.filter((v) =>
    v.rule_id.startsWith('parallel-ok.'),
  );
}

describe('parallelOkContent rules — markdown parity', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  function setup(): { repoRoot: string; handoffsDir: string; stepsDir: string } {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-ok-content-test-'));
    createdRoots.push(repoRoot);
    createWorkspace(repoRoot);
    const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
    return { repoRoot, handoffsDir: handoffs, stepsDir: implementationSteps };
  }

  it('passes when Complex decision has correct slice list (markdown)', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1.md\n- slice-2.md\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    writeFile(stepsDir, 'slice-1.md', '');
    writeFile(stepsDir, 'slice-2.md', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.filter((v) => v.rule_id === 'parallel-ok.slices-exist')).toEqual([]);
  });

  it('fires slices-exist violation when slice file missing (markdown)', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1.md\n- slice-99.md\n\n## Constraints\n\nSome constraints.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    writeFile(stepsDir, 'slice-1.md', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.some((v) =>
      v.rule_id === 'parallel-ok.slices-exist' &&
      v.message.includes('slice-99'),
    )).toBe(true);
  });

  it('fires independent-slices-has-items violation when Complex with no slices listed', async () => {
    const { repoRoot, handoffsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.some((v) => v.rule_id === 'parallel-ok.independent-slices-has-items')).toBe(true);
  });

  it('skips when Simple decision (markdown)', async () => {
    const { repoRoot, handoffsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nSimple\n\n## Independent Slices\n\nNone.\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.filter((v) => v.rule_id === 'parallel-ok.slices-exist')).toEqual([]);
    expect(violations.filter((v) => v.rule_id === 'parallel-ok.independent-slices-has-items')).toEqual([]);
  });
});

describe('parallelOkContent rules — XML format awareness', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });

  function setup(): { repoRoot: string; handoffsDir: string; stepsDir: string } {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'parallel-ok-xml-test-'));
    createdRoots.push(repoRoot);
    createWorkspace(repoRoot);
    writeTaskJson(repoRoot, 'xml');
    const { handoffs, implementationSteps } = resolvePaths({ repoRoot, taskId: TEST_TASK_ID });
    return { repoRoot, handoffsDir: handoffs, stepsDir: implementationSteps };
  }

  it('accepts bare slice-N in XML mode', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1\n- slice-2\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    writeFile(stepsDir, 'slice-1.xml', '');
    writeFile(stepsDir, 'slice-2.xml', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.filter((v) => v.rule_id === 'parallel-ok.slices-exist')).toEqual([]);
  });

  it('accepts slice-N.xml reference in XML mode', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1.xml\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    writeFile(stepsDir, 'slice-1.xml', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.filter((v) => v.rule_id === 'parallel-ok.slices-exist')).toEqual([]);
  });

  it('fires slices-exist when XML mode slice file is missing', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1\n- slice-99\n\n## Constraints\n\nSome.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    writeFile(stepsDir, 'slice-1.xml', '');

    const violations = await runParallelOkRules(repoRoot);
    expect(violations.some((v) =>
      v.rule_id === 'parallel-ok.slices-exist' &&
      v.message.includes('slice-99'),
    )).toBe(true);
  });

  it('does not match slice-N.md as existing slices in XML mode', async () => {
    const { repoRoot, handoffsDir, stepsDir } = setup();
    writeFile(handoffsDir, 'parallel-ok.md',
      '# Parallel OK\n\n## Task Metadata\n- Task ID: task-test-001\n\n## Decision\n\nComplex\n\n## Independent Slices\n\n- slice-1\n\n## Constraints\n\nNone.\n',
    );
    writeFile(handoffsDir, 'implementation-spec.md', '');
    // Only a markdown slice exists, not XML
    writeFile(stepsDir, 'slice-1.md', '');

    const violations = await runParallelOkRules(repoRoot);
    // slice-1 is listed but no slice-1.xml exists → violation
    expect(violations.some((v) => v.rule_id === 'parallel-ok.slices-exist')).toBe(true);
  });
});
