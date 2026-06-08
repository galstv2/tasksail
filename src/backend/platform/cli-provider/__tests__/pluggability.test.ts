import { describe, it, expect, beforeAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  registerProvider,
  loadCliProvider,
  resolveCliProviderId,
  resetProvider,
  REQUIRED_REGISTRY_FIELDS,
  WORKFLOW_ROLE_IDS,
  PLANNER_ROLE_ID,
} from '../index.js';
import type { AgentId } from '../../core/index.js';
import { resolveAgentProfile } from '../../agent-runner/metadata.js';
import type { RegistryJson } from '../../agent-runner/types.js';
import { loadNamedAgentTeam } from '../../workflow-policy/agents.js';
import { stubProvider, STUB_PROVIDER_ID } from './stubProvider.js';

const REPO = process.cwd();

// The ONLY edit a conforming new provider makes to shared code: this one call.
beforeAll(() => {
  registerProvider(stubProvider);
});

function stubEntry(roleId: string, order: number): Record<string, unknown> {
  return {
    agent_id: roleId,
    role_name: roleId,
    human_name: `Stub ${roleId}`,
    autonomy_profile: 'repo-executor',
    workflow_order: order,
    required_model: 'stub-model-1',
    instruction_path: `.stub/instructions/${roleId}.md`,
    agent_profile_path: `.stub/agents/${roleId}.md`,
  };
}

describe('CLI-provider pluggability — synthetic second provider', () => {
  it('registers and resolves a non-Copilot provider', () => {
    expect(resolveCliProviderId(REPO, STUB_PROVIDER_ID)).toBe(STUB_PROVIDER_ID);
    expect(loadCliProvider(REPO, STUB_PROVIDER_ID)).toBe(stubProvider);
  });

  it('rejects duplicate and empty-id registration', () => {
    expect(() => registerProvider(stubProvider)).toThrow(/already registered/);
    expect(() => registerProvider({ ...stubProvider, id: '  ' })).toThrow(/non-empty id/);
  });

  it('reuses the neutral workflow contract and emits non-Copilot output', () => {
    expect([...stubProvider.requiredRegistryFields()]).toEqual([...REQUIRED_REGISTRY_FIELDS]);
    expect(stubProvider.plannerAgentId()).toBe(PLANNER_ROLE_ID);
    expect(stubProvider.formatCommand(['--role', 'software-engineer'])).toBe(
      'stub-cli --role software-engineer',
    );
  });

  it('drives agent-runner metadata resolution via the contract (non-Copilot paths)', () => {
    const registry = {
      agents: [
        {
          agent_id: 'software-engineer',
          role_name: 'Software Engineer',
          human_name: 'Stub Dalton',
          required_model: 'stub-model-1',
          autonomy_profile: 'repo-executor',
          allowed_dirs: [],
          deny_rules: [],
          workflow_order: 3,
          instruction_path: '.stub/instructions/software-engineer.md',
          agent_profile_path: '.stub/agents/software-engineer.md',
        },
      ],
    } as unknown as RegistryJson;

    const profile = resolveAgentProfile(stubProvider, registry, 'dalton' as AgentId);
    expect(profile.registryId).toBe('software-engineer');
    expect(profile.instructionPath).toBe('.stub/instructions/software-engineer.md');
    expect(profile.agentProfilePath).toBe('.stub/agents/software-engineer.md');
  });

  it('loads the named agent team through workflow-policy under the stub provider', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'cli-provider-plug-'));
    try {
      vi.stubEnv('TASKSAIL_CLI_PROVIDER', STUB_PROVIDER_ID);
      resetProvider(repoRoot);
      mkdirSync(path.join(repoRoot, '.stub', 'agents'), { recursive: true });
      writeFileSync(
        path.join(repoRoot, '.stub', 'agents', 'registry.json'),
        JSON.stringify({ agents: WORKFLOW_ROLE_IDS.map((id, i) => stubEntry(id, i + 1)) }),
        'utf-8',
      );

      const { team, errors } = await loadNamedAgentTeam(repoRoot);

      expect(errors).toEqual([]);
      expect(Object.keys(team).sort()).toEqual([...WORKFLOW_ROLE_IDS].sort());
    } finally {
      vi.unstubAllEnvs();
      resetProvider(repoRoot);
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
