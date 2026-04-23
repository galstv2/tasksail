import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PolicyValidator } from '../index.js';

function createRegistryFixture(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
  mkdirSync(path.join(repoRoot, '.github', 'copilot', 'instructions'), { recursive: true });

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

  writeFileSync(
    path.join(repoRoot, '.github', 'copilot', 'instructions', 'product-manager.instructions.md'),
    '# Product Manager (Alice) — Instructions\n',
    'utf-8',
  );
  writeFileSync(
    path.join(repoRoot, '.github', 'copilot', 'instructions', 'software-engineer.instructions.md'),
    '# Software Engineer (Dalton) — Instructions\n',
    'utf-8',
  );
  writeFileSync(
    path.join(repoRoot, '.github', 'copilot', 'instructions', 'qa.instructions.md'),
    '# QA and Closeout (Ron) — Instructions\n',
    'utf-8',
  );

  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'product-manager.md'),
    [
      '---',
      'name: product-manager',
      'description: Product manager profile',
      'model: gpt-5.4',
      '---',
      '',
      'Alice is the Product Manager.',
      'Follow the repository workflow and the Product Manager instructions.',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'software-engineer.md'),
    [
      '---',
      'name: software-engineer',
      'description: Software engineer profile',
      'model: gpt-4.1',
      '---',
      '',
      'Dalton is the Software Engineer.',
      'Follow the repository workflow and the Software Engineer instructions.',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'qa.md'),
    [
      '---',
      'name: qa',
      'description: QA profile',
      'model: gpt-5.4',
      '---',
      '',
      'Ron is QA and Closeout.',
      'Follow the repository workflow and the QA and Closeout instructions.',
    ].join('\n'),
    'utf-8',
  );
}

const TEST_TASK_ID = 'task-test-001';

function createWorkspaceFixture(repoRoot: string): void {
  const handoffsDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', TEST_TASK_ID, 'handoffs');
  mkdirSync(handoffsDir, { recursive: true });
  mkdirSync(path.join(repoRoot, 'AgentWorkSpace', 'pendingitems'), { recursive: true });

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

describe('workflow-policy runtime rule parity', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('enforces bootstrap manifest repository parity with answers', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-bootstrap-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);
    createWorkspaceFixture(repoRoot);

    const contextPackDir = path.join(repoRoot, 'contextpacks', 'demo-pack');
    mkdirSync(path.join(contextPackDir, 'qmd', 'bootstrap'), { recursive: true });

    writeFileSync(
      path.join(contextPackDir, 'qmd', 'bootstrap', 'bootstrap-answers.json'),
      JSON.stringify({
        context_pack_id: 'demo-pack',
        repositories: [
          {
            repo_id: 'platform',
            repo_name: 'TaskSail',
            repo_root: '/repos/tasksail',
            system_layer: 'backend',
          },
        ],
      }, null, 2),
      'utf-8',
    );
    writeFileSync(
      path.join(contextPackDir, 'qmd', 'repo-sources.json'),
      JSON.stringify({
        context_pack_id: 'demo-pack',
        qmd_scope_root: 'qmd/context-packs/demo-pack',
        repositories: [
          {
            repo_id: 'platform',
            repo_name: 'TaskSail Platform',
            local_paths: ['/other/path'],
            system_layer: 'frontend',
          },
        ],
      }, null, 2),
      'utf-8',
    );

    const validator = new PolicyValidator({
      rootDir: repoRoot,
      contextPackDir,
      mode: 'activation-bootstrap',
      taskId: TEST_TASK_ID,
    });

    const result = await validator.evaluate();

    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule_id: 'bootstrap.repo-contract-match',
        message: "Repository 'platform' changed repo_name between bootstrap answers ('TaskSail') and repo manifest ('TaskSail Platform').",
      }),
      expect.objectContaining({
        rule_id: 'bootstrap.repo-contract-match',
        message: "Repository 'platform' changed local path between bootstrap answers ('/repos/tasksail') and repo manifest ([\"/other/path\"]).",
      }),
      expect.objectContaining({
        rule_id: 'bootstrap.repo-contract-match',
        message: "Repository 'platform' changed system_layer between bootstrap answers ('backend') and repo manifest ('frontend').",
      }),
    ]));
  });
});
