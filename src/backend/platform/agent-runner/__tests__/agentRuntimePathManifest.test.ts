import { describe, expect, it } from 'vitest';
import {
  buildAgentRuntimePathManifest,
  prependRuntimePathManifestToPrompt,
  renderAgentRuntimePathManifestForPrompt,
  type AgentRuntimePathManifestValueKind,
} from '../agentRuntimePathManifest.js';
import { copilotProvider } from '../../cli-provider/providers/copilot/index.js';

// Derives the bullet prefix `- NAME (kind): value --` from the production renderer.
// Centralizes the format so a single template change ripples through one place
// instead of breaking N toContain assertions silently at the wrong location.
function bulletPrefix(name: string, kind: AgentRuntimePathManifestValueKind, value: string): string {
  const rendered = renderAgentRuntimePathManifestForPrompt({
    agentId: 'fixture',
    agentCwd: '/fixture',
    entries: [{ name, value, kind, description: 'fixture-description' }],
  });
  const bullet = rendered.split('\n').find((line) => line.startsWith(`- ${name} `));
  if (!bullet) throw new Error(`renderer did not emit a bullet for ${name}`);
  return bullet.replace(/ fixture-description$/, '').trimEnd();
}

describe('agentRuntimePathManifest', () => {
  it('renders deterministic allowlisted entries and omits arbitrary env keys', () => {
    const env = {
      TASKSAIL_TASK_ID: 'task-1',
      TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform"}]',
      TASKSAIL_TASK_BRANCHES_FILE: '/runtime/task-1/task-branches.json',
      RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"boundary":"repo-root"}',
      EXTERNAL_MCP_CONTEXT_FILE: '/runtime/mcp/context.json',
      COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
      COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
      COPILOT_WRITABLE_ROOTS_JSON: '[{"path":"/repo/src","kind":"directory"}]',
      COPILOT_PRIMARY_FOCUS_PATH: 'src/index.ts',
      SECRET_TOKEN: 'do-not-render',
    };
    const args = {
      agentId: 'ron',
      launchPhase: 'Artifact Cleanup',
      agentCwd: '/repo',
      env,
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
    };

    const first = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest(args));
    const second = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest(args));

    expect(first).toBe(second);
    expect(first).toContain('## Runtime Path Manifest');
    expect(first).toContain('Agent launch CWD: /repo');
    expect(first).toContain('Do not write $NAME or $NAME/... as a literal filesystem path; resolve the variable through this manifest first.');
    expect(first).toContain('If a value is JSON, parse it before using paths or branch metadata.');
    expect(first).toContain('If a _FILE value is present, read that file for the payload instead of guessing the inline value.');
    expect(first).toContain('Omitted variables are unavailable for this launch.');
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_ID', 'scalar', 'task-1'));
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_BRANCHES', 'json', '[{"repoId":"platform"}]'));
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_BRANCHES_FILE', 'file', '/runtime/task-1/task-branches.json'));
    expect(first).toContain(bulletPrefix('RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON', 'json', '{"boundary":"repo-root"}'));
    expect(first).toContain(bulletPrefix('EXTERNAL_MCP_CONTEXT_FILE', 'file', '/runtime/mcp/context.json'));
    expect(first).toContain(bulletPrefix('COPILOT_HANDOFFS_DIR', 'path', '/repo/AgentWorkSpace/tasks/task-1/handoffs'));
    expect(first).toContain(bulletPrefix('COPILOT_IMPL_STEPS_DIR', 'path', '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps'));
    expect(first).toContain(bulletPrefix('COPILOT_WRITABLE_ROOTS_JSON', 'json', '[{"path":"/repo/src","kind":"directory"}]'));
    expect(first).toContain(bulletPrefix('COPILOT_PRIMARY_FOCUS_PATH', 'path', 'src/index.ts'));
    expect(first).not.toContain('SECRET_TOKEN');
    expect(first).not.toContain('do-not-render');
    expect(first.indexOf('TASKSAIL_TASK_ID')).toBeLessThan(first.indexOf('COPILOT_HANDOFFS_DIR'));
  });

  it('prepends the manifest without mutating prompt text', () => {
    const manifest = buildAgentRuntimePathManifest({
      agentId: 'alice',
      agentCwd: '/repo',
      env: { TASKSAIL_TASK_ID: 'task-2' },
      providerEnvVars: [],
    });

    expect(prependRuntimePathManifestToPrompt({ prompt: 'Launch prompt.', manifest }))
      .toBe(`${renderAgentRuntimePathManifestForPrompt(manifest)}\n\nLaunch prompt.`);
  });
});
