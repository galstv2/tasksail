import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadNamedAgentTeam } from '../agents.js';

function createRegistryFixture(repoRoot: string): void {
  mkdirSync(path.join(repoRoot, '.github', 'agents'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, '.github', 'agents', 'registry.json'),
    JSON.stringify({
      agents: [
        {
          agent_id: 'planning-agent',
          role_name: 'Planning Intake Agent',
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
          agent_id: 'software-engineer-verify',
          role_name: 'Verification Engineer',
          human_name: 'Dalton (Verify)',
          instruction_path: '',
          agent_profile_path: '',
          autonomy_profile: 'repo-executor',
          workflow_order: 99,
          required_model: 'claude-sonnet-4.6',
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

describe('loadNamedAgentTeam', () => {
  const createdRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map((repoRoot) => rm(repoRoot, { recursive: true, force: true })));
  });

  it('filters auxiliary verification agents out of the canonical workflow team', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'workflow-policy-agents-'));
    createdRoots.push(repoRoot);
    createRegistryFixture(repoRoot);

    const { team, errors } = await loadNamedAgentTeam(repoRoot);

    expect(Object.keys(team)).toEqual([
      'planning-agent',
      'product-manager',
      'software-engineer',
      'qa',
    ]);
    expect(team['software-engineer-verify']).toBeUndefined();
    expect(team['planning-agent']?.expectedInstructionHeading).toBe(
      '# Planning Intake Agent Instructions',
    );
    expect(team['planning-agent']?.expectedAgentIdentity).toBe(
      'Act as the Planning Intake Agent.',
    );
    expect(team['product-manager']?.expectedInstructionHeading).toBe(
      '# Product Manager (Alice) — Instructions',
    );
    expect(team['product-manager']?.expectedAgentIdentity).toBe(
      'Act as Alice, the Product Manager.',
    );
    expect(errors).toEqual([]);
  });
});
