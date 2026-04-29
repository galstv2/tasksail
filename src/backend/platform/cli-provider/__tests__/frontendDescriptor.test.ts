import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getProviderFrontendDescriptor } from '../frontendDescriptor.js';
import { resetProvider } from '../registry.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-provider-descriptor-'));
  resetProvider();
  fs.mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.platform-state/platform.json'),
    JSON.stringify({ schema_version: 1, cli_provider: 'copilot', container_runtime: 'podman' }),
    'utf-8',
  );
  fs.mkdirSync(path.join(repoRoot, '.github/agents'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, '.github/agents/registry.json'),
    JSON.stringify({
      schema_version: 1,
      agents: [
        { agent_id: 'qa', role_name: 'QA', human_name: 'Ron', workflow_order: 5 },
        { agent_id: 'planning-agent', role_name: 'Planning Intake', human_name: 'Lily', workflow_order: 1 },
      ],
    }),
    'utf-8',
  );
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  resetProvider();
});

describe('getProviderFrontendDescriptor', () => {
  it('returns serializable provider descriptor with active registry roster ordering', () => {
    const descriptor = getProviderFrontendDescriptor(repoRoot);

    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(descriptor.providerId).toBe('copilot');
    expect(descriptor.homeDirName).toBe('copilot-home');
    expect(descriptor.registryPath).toBe(path.join(repoRoot, '.github/agents/registry.json'));
    expect(descriptor.agentConfigPaths.registry).toBe('.github/agents/registry.json');
    expect(descriptor.promptPathEnvVars.handoffsDir).toBe('COPILOT_HANDOFFS_DIR');
    expect(descriptor.contextPackEnvVars.paths).toBe('COPILOT_CONTEXT_PACK_PATHS');
    expect(descriptor.roster).toEqual([
      {
        agentId: 'planning-agent',
        roleName: 'Planning Intake',
        humanName: 'Lily',
        workflowOrder: 1,
      },
      {
        agentId: 'qa',
        roleName: 'QA',
        humanName: 'Ron',
        workflowOrder: 5,
      },
    ]);
  });
});
