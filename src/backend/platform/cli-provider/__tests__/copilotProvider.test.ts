import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AutonomyIntent, ProviderAgentProfile } from '../types.js';
import { copilotProvider } from '../providers/copilot/index.js';
import { applyCopilotPlannerPersonality } from '../providers/copilot/plannerPersonality.js';

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
  it('exposes provider-owned Class-2 literals exactly', () => {
    expect(copilotProvider.cliDisplayName()).toBe('Copilot CLI');
    expect(copilotProvider.platformRepoRootEnvVar()).toBe('COPILOT_PLATFORM_REPO_ROOT');
    expect(copilotProvider.instructionPathForRole('qa')).toBe('.github/copilot/instructions/qa.instructions.md');
    expect(copilotProvider.instructionPathForRole('software-engineer')).toBe('.github/copilot/instructions/software-engineer.instructions.md');
    expect(copilotProvider.skillDirsEnvKey()).toBe('COPILOT_SKILLS_DIRS');
    expect(copilotProvider.modelCatalogPaths()).toEqual({
      default: 'config/agent-model-catalog.default.json',
      runtime: '.platform-state/agent-model-catalog.json',
    });
    expect(copilotProvider.requiredRegistryFields()).toEqual(['instruction_path', 'agent_profile_path']);
  });

  it('inspects plugin metadata through the Copilot plugin manifest reader', async () => {
    const pluginDir = path.join(repoRoot, 'plugin');
    fs.mkdirSync(path.join(pluginDir, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'plugin.json'),
      JSON.stringify({
        name: 'metadata-plugin',
        description: 'Metadata plugin description.',
        version: '1.2.3',
        skills: ['skills'],
        mcp: {},
      }),
      'utf-8',
    );

    await expect(copilotProvider.inspectPluginMetadata(pluginDir)).resolves.toEqual({
      manifestPath: path.join(pluginDir, 'plugin.json'),
      name: 'metadata-plugin',
      description: 'Metadata plugin description.',
      version: '1.2.3',
      skillPathCount: 1,
      declaredComponentClasses: ['mcp'],
    });
  });

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
    expect(copilotProvider.resolvePromptPath('plan-task')).toBe('.github/copilot/prompts/plan-task.prompt.md');
    expect(copilotProvider.resolvePromptPath('retrospective-task')).toBe('.github/copilot/prompts/retrospective-task.prompt.md');
    expect(copilotProvider.resolvePromptPath('realignment-task')).toBe('.github/copilot/prompts/realignment-task.prompt.md');
    expect(copilotProvider.requiredDirs()).toEqual(['.github/agents', '.github/copilot']);
    expect(copilotProvider.requiredEnvKeys()).toEqual(['COPILOT_MODEL', 'COPILOT_AGENT_ID']);
    expect(copilotProvider.controlledEnvKeys()).toEqual(expect.arrayContaining([
      'COPILOT_MODEL',
      'COPILOT_AGENT_ID',
      'COPILOT_HANDOFFS_DIR',
      'COPILOT_WRITABLE_ROOTS_JSON',
    ]));
    expect(copilotProvider.promptPathEnvVars()).toEqual({
      handoffsDir: 'COPILOT_HANDOFFS_DIR',
      implStepsDir: 'COPILOT_IMPL_STEPS_DIR',
    });
    expect(copilotProvider.contextPackEnvVars()).toEqual({
      paths: 'COPILOT_CONTEXT_PACK_PATHS',
      searchRoots: 'COPILOT_CONTEXT_PACK_SEARCH_ROOTS',
    });
    expect(copilotProvider.runtimeManifestEnvVars()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'COPILOT_HANDOFFS_DIR', kind: 'path' }),
      expect.objectContaining({ name: 'COPILOT_IMPL_STEPS_DIR', kind: 'path' }),
      expect.objectContaining({ name: 'COPILOT_WRITABLE_ROOTS_JSON', kind: 'json' }),
      expect.objectContaining({ name: 'COPILOT_PRIMARY_FOCUS_PATH', kind: 'path' }),
    ]));
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

  it('buildArgs emits effort only for non-empty non-none intent values', () => {
    expect(copilotProvider.buildArgs(profile, { ...intent, reasoningEffort: 'high' }, {
      launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
    }).args).toEqual(expect.arrayContaining(['--effort', 'high']));

    for (const reasoningEffort of [undefined, '', 'none']) {
      const result = copilotProvider.buildArgs(profile, { ...intent, reasoningEffort }, {
        launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
      });
      expect(result.args).not.toContain('--effort');
    }
  });

  it('buildArgs applies the git deny floor to qa executor autonomy', () => {
    const result = copilotProvider.buildArgs(
      {
        ...profile,
        id: 'ron',
        registryId: 'qa',
        displayName: 'Ron',
        role: 'QA',
        autonomyProfile: 'qa-executor',
        denyRules: [],
      },
      {
        ...intent,
        autonomyProfile: 'qa-executor',
        allowedDirs: ['/repo', '/context'],
      },
      {
        launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
      },
    );

    expect(result.resolvedToolPolicy).toMatchObject({
      allowAllTools: true,
      noAskUser: true,
      allowTools: [],
    });
    expect(result.resolvedToolPolicy.denyTools).toEqual(expect.arrayContaining([
      'shell(git add)',
      'shell(git commit)',
      'shell(git push)',
      'shell(gh pr create)',
      'shell(rm:*)',
      'shell(sudo)',
      'shell(su)',
      'shell(doas)',
      'shell(chown:*)',
    ]));
    expect(result.args).toEqual(expect.arrayContaining([
      '--allow-all-tools',
      '--no-ask-user',
      '--deny-tool',
      'shell(git add)',
      'shell(git commit)',
      'shell(git push)',
    ]));
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
      primaryFocusTargetsJson: '[{"path":"src/index.ts","kind":"file","role":"anchor","testTarget":{"path":"tests/index.test.ts","kind":"file"},"supportTargets":[{"path":"src/types.ts","kind":"file"}]},{"path":"src/admin.ts","kind":"file","role":"primary"}]',
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
      COPILOT_PRIMARY_FOCUS_TARGETS_JSON: '[{"path":"src/index.ts","kind":"file","role":"anchor","testTarget":{"path":"tests/index.test.ts","kind":"file"},"supportTargets":[{"path":"src/types.ts","kind":"file"}]},{"path":"src/admin.ts","kind":"file","role":"primary"}]',
      COPILOT_WRITABLE_ROOTS_JSON: '[{"path":"src","kind":"directory","reason":"primary-focus-parent"}]',
      COPILOT_READONLY_CONTEXT_ROOTS_JSON: '[{"path":"docs","kind":"directory","reason":"support-target"}]',
      COPILOT_TEST_TARGET_PATH: 'tests/index.test.ts',
      COPILOT_TEST_TARGET_KIND: 'file',
      COPILOT_CONTEXT_PACK_PATHS: '/context',
      COPILOT_CONTEXT_PACK_SEARCH_ROOTS: '/repo',
    });
    expect(env).not.toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(env).not.toHaveProperty('COPILOT_IMPL_STEPS_DIR');
    expect(env).not.toHaveProperty('COPILOT_REASONING_EFFORT');
  });

  it('buildArgs appends one --plugin-dir pair per staged plugin dir after add-dir roots', () => {
    const result = copilotProvider.buildArgs(profile, intent, {
      launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
      launchExtensions: {
        pluginDirs: ['/stage/plugins/p1', '/stage/plugins/p2'],
        skillDirs: ['/stage/skills'],
      },
    });

    // Repeated --plugin-dir pairs in deterministic input order, after --add-dir.
    expect(result.args.slice(result.args.lastIndexOf('--add-dir') + 2)).toEqual([
      '--plugin-dir', '/stage/plugins/p1',
      '--plugin-dir', '/stage/plugins/p2',
    ]);
    // Skill dirs are env-only; they never appear in argv.
    expect(result.args).not.toContain('/stage/skills');
  });

  it('buildArgs emits no --plugin-dir when launchExtensions carries no plugin dirs', () => {
    const result = copilotProvider.buildArgs(profile, intent, {
      launchContext: { repoRoot: '/repo', requestedCwd: '/repo' },
      launchExtensions: { pluginDirs: [], skillDirs: ['/stage/skills'] },
    });
    expect(result.args).not.toContain('--plugin-dir');
  });

  it('buildEnv adds COPILOT_SKILLS_DIRS only when skillDirs is non-empty and never leaks plugin dirs', () => {
    const withSkills = copilotProvider.buildEnv({
      model: 'gpt-5.2',
      agentId: 'software-engineer',
      platformRepoRoot: '/repo',
      launchExtensions: { pluginDirs: ['/stage/plugins/p1'], skillDirs: ['/s/a', '/s/b'] },
    });
    expect(withSkills['COPILOT_SKILLS_DIRS']).toBe('/s/a,/s/b');
    expect(Object.values(withSkills)).not.toContain('/stage/plugins/p1');

    const noSkills = copilotProvider.buildEnv({
      model: 'gpt-5.2',
      agentId: 'software-engineer',
      platformRepoRoot: '/repo',
      launchExtensions: { pluginDirs: ['/stage/plugins/p1'], skillDirs: [] },
    });
    expect(noSkills).not.toHaveProperty('COPILOT_SKILLS_DIRS');
  });

  it('treats COPILOT_SKILLS_DIRS as provider-controlled but never records it in runtime manifest env descriptors', () => {
    // Controlled: scrubbed if inherited, so a stray ambient value cannot reach the agent.
    expect(copilotProvider.controlledEnvKeys()).toContain('COPILOT_SKILLS_DIRS');
    // Excluded from the runtime path manifest descriptors, so staged skill paths never
    // surface in the runtime path manifest written into the launch payload.
    expect(copilotProvider.runtimeManifestEnvVars().map((item) => item.name)).not.toContain('COPILOT_SKILLS_DIRS');
  });

  it('exposes reasoning effort capabilities without effort env or runtime manifest leakage', async () => {
    fs.mkdirSync(path.join(repoRoot, '.platform-state'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, '.platform-state', 'copilot-cli-capabilities.json'), JSON.stringify({
      schema_version: 1,
      provider_id: 'copilot',
      cli_version: 'GitHub Copilot CLI 1.0.54',
      captured_at: new Date().toISOString(),
      reasoning_effort_choices: ['low', 'medium', 'high'],
    }));

    await expect(copilotProvider.reasoningEffortCapabilities?.(repoRoot)).resolves.toMatchObject({
      providerId: 'copilot',
      source: 'cache',
      effortChoices: ['low', 'medium', 'high'],
    });
    expect(copilotProvider.controlledEnvKeys().join('\n')).not.toMatch(/REASONING|EFFORT/u);
    expect(copilotProvider.runtimeManifestEnvVars().map((item) => item.name).join('\n')).not.toMatch(/REASONING|EFFORT/u);
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

  it('SEC-TS-02: writes mcp-config.json + launch dir with owner-only permissions', () => {
    if (process.platform === 'win32') return; // POSIX mode bits only
    const launchDir = path.join(repoRoot, 'launch-perms');
    const configPath = copilotProvider.renderMcpConfig(launchDir, [{
      id: 'repo-context',
      transport: 'sse',
      url: 'http://localhost:8811/sse',
      headers: { Authorization: 'Bearer secret-token' },
    }]);
    // Resolved Bearer token in the config must not be group/world readable.
    expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(launchDir).mode & 0o777).toBe(0o700);
  });

  it('renders local, url-with-tools, and url-without-tools MCP entries with correct shapes', () => {
    const configPath = copilotProvider.renderMcpConfig(path.join(repoRoot, 'launch-mixed'), [
      {
        id: 'local-fs',
        transport: 'local',
        command: 'npx',
        args: ['-y', '@scope/server'],
        env: { API_KEY: 'resolved-secret' },
        cwd: '/abs/work',
        tools: ['read_file', 'list_dir'],
      },
      {
        id: 'vendor-http',
        transport: 'http',
        url: 'https://mcp.vendor.com/mcp',
        headers: { Authorization: 'Bearer tok' },
        tools: ['search'],
      },
      {
        id: 'plain-sse',
        transport: 'sse',
        url: 'https://mcp.example.com/sse',
        headers: {},
      },
    ]);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(parsed.mcpServers['local-fs']).toEqual({
      type: 'local',
      command: 'npx',
      args: ['-y', '@scope/server'],
      env: { API_KEY: 'resolved-secret' },
      cwd: '/abs/work',
      tools: ['read_file', 'list_dir'],
    });
    expect(parsed.mcpServers['vendor-http']).toEqual({
      type: 'http',
      url: 'https://mcp.vendor.com/mcp',
      headers: { Authorization: 'Bearer tok' },
      tools: ['search'],
    });
    // A url server without a tools allowlist omits tools entirely (prior behavior).
    expect(parsed.mcpServers['plain-sse']).toEqual({
      type: 'sse',
      url: 'https://mcp.example.com/sse',
      headers: {},
    });
    expect(parsed.mcpServers['plain-sse'].tools).toBeUndefined();
  });

  it('omits cwd for a local entry when not set', () => {
    const configPath = copilotProvider.renderMcpConfig(path.join(repoRoot, 'launch-nocwd'), [{
      id: 'local-nocwd',
      transport: 'local',
      command: 'mcp-server',
      args: [],
      env: {},
      tools: ['t1'],
    }]);
    const entry = JSON.parse(fs.readFileSync(configPath, 'utf-8')).mcpServers['local-nocwd'];
    expect(entry.cwd).toBeUndefined();
    expect(entry).toEqual({ type: 'local', command: 'mcp-server', args: [], env: {}, tools: ['t1'] });
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
    expect(spec!.args).toContain('--agent');
    expect(spec!.args).toContain('planning-agent');
    expect(spec!.args).not.toContain('planning-agent-clinical');
    expect(spec!.args.at(spec!.args.indexOf('-i') + 1)).toBe('plan it');

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

  it('injects selected planner personality prompts and defaults omissions to balanced', () => {
    const balanced = applyCopilotPlannerPersonality('Plan this.', undefined);
    expect(balanced).toContain('--- TASKSAIL RUNTIME PLANNING STYLE PROFILE ---');
    expect(balanced).toContain('Use the Balanced Planning Specialist style.');
    expect(balanced).toContain('Plan this.');

    const clinical = applyCopilotPlannerPersonality('Plan this.', 'clinical');
    expect(clinical).toContain('Use the Clinical Planning Specialist style.');
    expect(clinical).toContain('Plan this.');
  });

  it('memoizes planner personality prompts by exact repo root and personality id', () => {
    const promptDir = path.join(repoRoot, '.github', 'copilot', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    const balancedPath = path.join(promptDir, 'lily-personality-balanced.prompt.md');
    const clinicalPath = path.join(promptDir, 'lily-personality-clinical.prompt.md');
    fs.writeFileSync(balancedPath, 'Balanced v1', 'utf-8');
    fs.writeFileSync(clinicalPath, 'Clinical v1', 'utf-8');

    const firstBalanced = applyCopilotPlannerPersonality('Plan this.', 'balanced', repoRoot);
    fs.writeFileSync(balancedPath, 'Balanced v2', 'utf-8');
    const secondBalanced = applyCopilotPlannerPersonality('Plan this again.', 'balanced', repoRoot);
    const clinical = applyCopilotPlannerPersonality('Plan clinically.', 'clinical', repoRoot);

    expect(firstBalanced).toContain('Balanced v1');
    expect(secondBalanced).toContain('Balanced v1');
    expect(secondBalanced).not.toContain('Balanced v2');
    expect(clinical).toContain('Clinical v1');
  });

  it('fails closed when an allowlisted planner personality prompt is missing or empty', () => {
    const promptDir = path.join(repoRoot, '.github', 'copilot', 'prompts');
    fs.mkdirSync(promptDir, { recursive: true });
    const balancedPath = path.join(promptDir, 'lily-personality-balanced.prompt.md');
    expect(() => applyCopilotPlannerPersonality('Plan this.', 'balanced', repoRoot))
      .toThrow(/ENOENT|no such file/i);

    fs.writeFileSync(balancedPath, '   ', 'utf-8');
    expect(() => applyCopilotPlannerPersonality('Plan this.', 'balanced', repoRoot))
      .toThrow('Copilot planner personality prompt "balanced" is empty.');

    fs.writeFileSync(balancedPath, 'Balanced after failures', 'utf-8');
    expect(applyCopilotPlannerPersonality('Plan this.', 'balanced', repoRoot))
      .toContain('Balanced after failures');
  });

  describe('runtime nickname <-> provider-agent-ID mapping', () => {
    const NICKNAME_TO_PROVIDER: Record<string, string> = {
      lily: 'planning-agent',
      alice: 'product-manager',
      dalton: 'software-engineer',
      'dalton-verify': 'software-engineer-verify',
      ron: 'qa',
    };

    it('maps all five runtime nicknames to their provider-agent IDs', () => {
      for (const [nickname, providerId] of Object.entries(NICKNAME_TO_PROVIDER)) {
        expect(copilotProvider.runtimeToProviderAgentId(nickname)).toBe(providerId);
      }
    });

    it('inverts all five provider-agent IDs back to their runtime nicknames', () => {
      for (const [nickname, providerId] of Object.entries(NICKNAME_TO_PROVIDER)) {
        expect(copilotProvider.providerToRuntimeAgentId(providerId)).toBe(nickname);
      }
    });

    it('passes existing provider-agent IDs through runtimeToProviderAgentId unchanged (idempotent)', () => {
      for (const providerId of Object.values(NICKNAME_TO_PROVIDER)) {
        expect(copilotProvider.runtimeToProviderAgentId(providerId)).toBe(providerId);
      }
    });

    it('returns undefined from providerToRuntimeAgentId for an unknown provider-agent ID', () => {
      expect(copilotProvider.providerToRuntimeAgentId('not-a-real-agent')).toBeUndefined();
    });

    it('maps dalton-verify to software-engineer-verify and never to software-engineer', () => {
      expect(copilotProvider.runtimeToProviderAgentId('dalton-verify')).toBe('software-engineer-verify');
      expect(copilotProvider.runtimeToProviderAgentId('dalton-verify')).not.toBe('software-engineer');
    });
  });
});
