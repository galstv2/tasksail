import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AutonomyIntent, ProviderAgentProfile } from '../types.js';
import { copilotProvider } from '../providers/copilot/index.js';

const profile: ProviderAgentProfile = {
  id: 'dalton',
  registryId: 'software-engineer',
  displayName: 'Dalton',
  role: 'Software Engineer',
  requiredModel: 'gpt-5.2-codex',
  autonomyProfile: 'repo-executor',
  workflowOrder: 3,
  instructionPath: '.github/copilot/instructions/software-engineer.instructions.md',
  agentProfilePath: '.github/agents/software-engineer.md',
  denyRules: ['shell(secret-tool)'],
};

const intent: AutonomyIntent = {
  model: 'gpt-5.2-codex',
  autonomyProfile: 'repo-executor',
  allowedDirs: ['/repo', '/context'],
  disallowTempDir: true,
};

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-provider-copilot-'));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('copilotProvider', () => {
  it('exposes Copilot command, paths, env keys, and prompt paths', () => {
    expect(copilotProvider.resolveCommand()).toBe(process.platform === 'win32' ? 'copilot.cmd' : 'copilot');
    expect(copilotProvider.homeDirName()).toBe('copilot-home');
    expect(copilotProvider.agentConfigPaths()).toEqual({
      root: '.github/copilot',
      instructions: '.github/copilot/instructions',
      globalInstructions: '.github/copilot/instructions/global.instructions.md',
      prompts: '.github/copilot/prompts',
      profiles: '.github/agents',
      registry: '.github/agents/registry.json',
    });
    expect(copilotProvider.resolvePromptPath('close-task')).toBe('.github/copilot/prompts/close-task.prompt.md');
    expect(copilotProvider.requiredDirs()).toEqual(['.github/agents', '.github/copilot']);
    expect(copilotProvider.requiredEnvKeys()).toEqual(['COPILOT_MODEL', 'COPILOT_AGENT_ID']);
    expect(copilotProvider.promptPathEnvVars()).toEqual({
      handoffsDir: 'COPILOT_HANDOFFS_DIR',
      implStepsDir: 'COPILOT_IMPL_STEPS_DIR',
    });
    expect(copilotProvider.contextPackEnvVars()).toEqual({
      paths: 'COPILOT_CONTEXT_PACK_PATHS',
      searchRoots: 'COPILOT_CONTEXT_PACK_SEARCH_ROOTS',
    });
  });

  it('buildArgs maps repo executor autonomy to Copilot flags and tool-policy facts', () => {
    const result = copilotProvider.buildArgs(profile, intent, {
      launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
    });

    expect(result.inlineAgentContext).toBe(false);
    expect(result.launchCwd).toBe('/repo');
    expect(result.args).toEqual([
      '--agent', 'software-engineer',
      '--model', 'gpt-5.2-codex',
      '--allow-all-tools',
      '--no-ask-user',
      '--disallow-temp-dir',
      '--deny-tool', 'shell(git add)',
      '--deny-tool', 'shell(git commit)',
      '--deny-tool', 'shell(git push)',
      '--deny-tool', 'shell(gh pr create)',
      '--deny-tool', 'shell(rm:*)',
      '--deny-tool', 'shell(sudo)',
      '--deny-tool', 'shell(su)',
      '--deny-tool', 'shell(doas)',
      '--deny-tool', 'shell(chown:*)',
      '--deny-tool', 'shell(secret-tool)',
      '--add-dir', '/repo',
      '--add-dir', '/context',
    ]);
    expect(result.resolvedToolPolicy).toEqual({
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
      denyTools: [
        'shell(git add)',
        'shell(git commit)',
        'shell(git push)',
        'shell(gh pr create)',
        'shell(rm:*)',
        'shell(sudo)',
        'shell(su)',
        'shell(doas)',
        'shell(chown:*)',
        'shell(secret-tool)',
      ],
    });
  });

  it('buildArgs inlines agent context for non-repo-root CWD and maps artifact-author policy', () => {
    const result = copilotProvider.buildArgs(
      { ...profile, autonomyProfile: 'artifact-author', denyRules: ['shell(custom)'] },
      { ...intent, autonomyProfile: 'artifact-author', allowedDirs: [], disallowTempDir: false },
      { launchContext: { repoRoot: '/repo', requestedCwd: '/repo/subdir' } },
    );

    expect(result.inlineAgentContext).toBe(true);
    expect(result.args).toEqual([
      '--model', 'gpt-5.2-codex',
      '--no-ask-user',
      '--allow-tool', 'write',
      '--deny-tool', 'shell',
      '--deny-tool', 'shell(custom)',
    ]);
    expect(result.resolvedToolPolicy.allowAllTools).toBe(false);
  });

  it('buildEnv maps generic input and omits optional handoff keys when absent', () => {
    const env = copilotProvider.buildEnv({
      model: 'gpt-5.2',
      agentId: 'software-engineer',
      platformRepoRoot: '/repo',
      wallClockTimeoutS: 120,
      idleTimeoutS: 30,
      disableIdleTimeout: true,
      targetReposJson: '["/repo"]',
      primaryFocusPath: 'src/index.ts',
      primaryFocusTargetKind: 'file',
      writableRootsJson: '[{"path":"src","kind":"directory","reason":"primary-focus-parent"}]',
      readonlyContextRootsJson: '[{"path":"docs","kind":"directory","reason":"support-target"}]',
      testTargetPath: 'tests/index.test.ts',
      testTargetKind: 'file',
      contextPackPaths: '/context',
      contextPackSearchRoots: '/repo',
    });

    expect(env).toMatchObject({
      COPILOT_MODEL: 'gpt-5.2',
      COPILOT_AGENT_ID: 'software-engineer',
      COPILOT_PLATFORM_REPO_ROOT: '/repo',
      COPILOT_WALL_CLOCK_TIMEOUT_S: '120',
      COPILOT_IDLE_TIMEOUT_S: '30',
      COPILOT_DISABLE_IDLE_TIMEOUT: 'true',
      COPILOT_TARGET_REPOS_JSON: '["/repo"]',
      COPILOT_PRIMARY_FOCUS_PATH: 'src/index.ts',
      COPILOT_PRIMARY_FOCUS_TARGET_KIND: 'file',
      COPILOT_WRITABLE_ROOTS_JSON: '[{"path":"src","kind":"directory","reason":"primary-focus-parent"}]',
      COPILOT_READONLY_CONTEXT_ROOTS_JSON: '[{"path":"docs","kind":"directory","reason":"support-target"}]',
      COPILOT_TEST_TARGET_PATH: 'tests/index.test.ts',
      COPILOT_TEST_TARGET_KIND: 'file',
      COPILOT_CONTEXT_PACK_PATHS: '/context',
      COPILOT_CONTEXT_PACK_SEARCH_ROOTS: '/repo',
    });
    expect(env).not.toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(env).not.toHaveProperty('COPILOT_IMPL_STEPS_DIR');
  });

  it('materializes inline prompt context from provider-owned paths', () => {
    fs.mkdirSync(path.join(repoRoot, '.github/copilot/instructions'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.github/agents'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, '.github/copilot/instructions/global.instructions.md'),
      'global instructions',
    );
    fs.writeFileSync(path.join(repoRoot, profile.agentProfilePath!), 'agent profile');
    fs.writeFileSync(path.join(repoRoot, profile.instructionPath!), 'role instructions');

    const result = copilotProvider.materializePrompt({
      prompt: 'launch prompt',
      promptPath: null,
      promptSource: 'override',
      profile,
      launchContext: { repoRoot, requestedCwd: path.join(repoRoot, 'worktree') },
      includeGlobalInstructions: true,
    });

    expect(result.inlineAgentContext).toBe(true);
    expect(result.effectivePrompt).toBe(
      'global instructions\n\n---\n\nagent profile\n\n---\n\nrole instructions\n\n---\n\nlaunch prompt',
    );
  });

  it('parses chatagent profiles and renders Copilot MCP config', () => {
    const parsed = copilotProvider.parseAgentProfile([
      '```chatagent',
      '---',
      'name: Dalton',
      'description: Software Engineer',
      'model: gpt-5.2',
      '---',
      'body text',
      '```',
    ].join('\n'));

    expect(parsed).toMatchObject({
      frontmatter: {
        name: 'Dalton',
        description: 'Software Engineer',
        model: 'gpt-5.2',
      },
      name: 'Dalton',
      description: 'Software Engineer',
      model: 'gpt-5.2',
      body: 'body text',
      errors: [],
    });

    const configPath = copilotProvider.renderMcpConfig(path.join(repoRoot, 'launch'), [{
      id: 'repo-context',
      transport: 'sse',
      url: 'http://localhost:8811/sse',
      headers: { Authorization: 'Bearer test' },
    }]);
    expect(copilotProvider.mcpConfigArgs(configPath)).toEqual(['--additional-mcp-config', `@${configPath}`]);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf-8'))).toEqual({
      mcpServers: {
        'repo-context': {
          type: 'sse',
          url: 'http://localhost:8811/sse',
          headers: { Authorization: 'Bearer test' },
        },
      },
    });
  });

  it('builds planner launch specs and parses Copilot planner JSONL', () => {
    const spec = copilotProvider.buildPlannerLaunchSpec!({
      model: 'gpt-5.4',
      resumeSessionId: 'abc',
      prompt: 'plan it',
      promptMode: 'interactive',
      allowedRoots: ['.'],
      contextPackBoundaryEnforced: true,
      workingDirectory: '/repo',
    });

    expect(spec).toMatchObject({
      launchCwd: '/repo',
      env: { COPILOT_MODEL: 'gpt-5.4' },
    });
    expect(spec!.args).toContain('--output-format');
    expect(spec!.args).toContain('--stream');
    expect(spec!.args).toContain('--resume=abc');
    expect(spec!.args).toContain('-i');

    const parser = copilotProvider.createPlannerParser!()!;
    const results = parser.parseChunk('{"type":"assistant.turn_start","data":{"turnId":"turn-1"}}\n{"type":"assistant.message_delta","data":{"deltaContent":"hello"}}\n{"type":"result","sessionId":"sess","exitCode":0}\n');
    expect(results.flatMap((result) => result.events).map((event) => event.type)).toEqual([
      'planner.turn.started',
      'planner.turn.message',
      'planner.session.updated',
      'planner.turn.completed',
    ]);
    expect(results[2].events[0]).toMatchObject({ cliSessionId: 'sess' });
  });
});
