import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildAgentEnvironment, buildAutonomyEnvironment } from '../environment.js';
import type { AgentProfile } from '../types.js';
import type { AutonomyIntent, BuildArgsResult } from '../../cli-provider/index.js';
import type { ExternalMcpLaunchContext } from '../pythonHelpers.js';

describe('buildAgentEnvironment', () => {
  const profile: AgentProfile = {
    id: 'dalton',
    registryId: 'software-engineer',
    displayName: 'Dalton',
    role: 'Software Engineer',
    requiredModel: 'claude-sonnet-4.5',
    autonomyProfile: 'repo-executor',
    workflowOrder: 3,
  };

  it('includes COPILOT_HANDOFFS_DIR and COPILOT_IMPL_STEPS_DIR by default', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo');
    expect(env).toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(env).toHaveProperty('COPILOT_IMPL_STEPS_DIR');
    expect(env['COPILOT_PLATFORM_REPO_ROOT']).toBe('/repo');
  });

  it('omits COPILOT_HANDOFFS_DIR and COPILOT_IMPL_STEPS_DIR when skipHandoffEnvVars is true', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', { skipHandoffEnvVars: true });
    expect(env).not.toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(env).not.toHaveProperty('COPILOT_IMPL_STEPS_DIR');
    // COPILOT_PLATFORM_REPO_ROOT should still be set
    expect(env['COPILOT_PLATFORM_REPO_ROOT']).toBe('/repo');
  });

  it('includes handoff env vars when skipHandoffEnvVars is false', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', { skipHandoffEnvVars: false });
    expect(env).toHaveProperty('COPILOT_HANDOFFS_DIR');
    expect(env).toHaveProperty('COPILOT_IMPL_STEPS_DIR');
  });

  it('threads taskId into handoffs/implSteps paths', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', undefined, 't1');
    expect(env['COPILOT_HANDOFFS_DIR']).toContain('tasks/t1');
    expect(env['COPILOT_IMPL_STEPS_DIR']).toContain('tasks/t1');
  });

  it('emits TASKSAIL_TASK_ID when taskId provided', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', undefined, 't1');
    expect(env['TASKSAIL_TASK_ID']).toBe('t1');
  });

  it('emits empty TASKSAIL_TASK_ID when taskId omitted', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo');
    expect(env['TASKSAIL_TASK_ID']).toBe('');
  });

  it('omits shared repo-context MCP env vars when no mcp endpoint is supplied', () => {
    // Without options.mcp the launch path has not resolved a shared MCP
    // endpoint, so we must not advertise a stale hardcoded default that could
    // mismatch a user-customized mcp_port. Authoritative scoping is the
    // per-launch MCP config headers rendered by the active provider.
    const env = buildAgentEnvironment(profile, '/ctx', '/repo');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_URL');
    expect(env).not.toHaveProperty('REPO_CONTEXT_MCP_PORT');
  });

  it('uses the launch-resolved shared repo-context MCP endpoint when provided', () => {
    const env = buildAgentEnvironment(profile, '/workspace/context-pack', '/repo', {
      mcp: {
        url: 'http://localhost:8899/sse',
        port: 8899,
      },
    });
    expect(env['ACTIVE_CONTEXT_PACK_DIR']).toBe('/workspace/context-pack');
    expect(env['REPO_CONTEXT_MCP_URL']).toBe('http://localhost:8899/sse');
    expect(env['REPO_CONTEXT_MCP_PORT']).toBe('8899');
  });

  it('emits writable and read-only Deep Focus root env vars when focused roots are present', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', {
      focused: {
        primaryRepoRoot: '/workspace/repo',
        visibleRepoRoots: ['/workspace/repo'],
        declaredRepoRoots: ['/workspace/repo'],
        estateType: 'distributed-platform',
        primaryRepoId: 'api',
        primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
        primaryFocusTargetKind: 'file',
        writableRoots: [
          { path: 'services/Acme.Api', kind: 'directory', reason: 'primary-focus-parent' },
          { path: 'services/Acme.Api.Tests', kind: 'directory', reason: 'test-target' },
        ],
        readonlyContextRoots: [
          { path: 'libs/Acme.Models', kind: 'directory', reason: 'support-target' },
        ],
        selectedRepoIds: ['api'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
    });

    expect(env['COPILOT_WRITABLE_ROOTS_JSON']).toBe(JSON.stringify([
      { path: 'services/Acme.Api', kind: 'directory', reason: 'primary-focus-parent' },
      { path: 'services/Acme.Api.Tests', kind: 'directory', reason: 'test-target' },
    ]));
    expect(env['COPILOT_READONLY_CONTEXT_ROOTS_JSON']).toBe(JSON.stringify([
      { path: 'libs/Acme.Models', kind: 'directory', reason: 'support-target' },
    ]));
  });

  it('emits repo-root writable sentinel when focused roots include it', () => {
    const env = buildAgentEnvironment(profile, '/ctx', '/repo', {
      focused: {
        primaryRepoRoot: '/workspace/repo',
        visibleRepoRoots: ['/workspace/repo'],
        declaredRepoRoots: ['/workspace/repo'],
        estateType: 'distributed-platform',
        primaryRepoId: 'api',
        primaryFocusRelativePath: '',
        deepFocusEnabled: true,
        writableRoots: [
          { path: '', kind: 'directory', reason: 'selected-primary' },
        ],
        readonlyContextRoots: [],
        selectedRepoIds: ['api'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
    });

    expect(env['COPILOT_WRITABLE_ROOTS_JSON']).toBe(JSON.stringify([
      { path: '', kind: 'directory', reason: 'selected-primary' },
    ]));
    expect(env['COPILOT_READONLY_CONTEXT_ROOTS_JSON']).toBe('[]');
  });

  describe('model-pin regression', () => {
    const aliceProfile: AgentProfile = {
      id: 'alice',
      registryId: 'product-manager',
      displayName: 'Alice',
      role: 'Product Manager',
      requiredModel: 'gpt-5.4',
      autonomyProfile: 'artifact-author',
      workflowOrder: 1,
    };

    const daltonProfile: AgentProfile = {
      id: 'dalton',
      registryId: 'software-engineer',
      displayName: 'Dalton',
      role: 'Software Engineer',
      requiredModel: 'gpt-4.1',
      autonomyProfile: 'repo-executor',
      workflowOrder: 2,
    };

    beforeEach(() => {
      vi.stubEnv('RUN_ROLE_AGENT_ACTIVE_MODEL', '');
      vi.stubEnv('COPILOT_MODEL', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('emits pinned model for Alice from registry even when parent env vars are cleared', () => {
      const env = buildAgentEnvironment(aliceProfile, '/ctx', '/repo');
      expect(env['RUN_ROLE_AGENT_ACTIVE_MODEL']).toBe('gpt-5.4');
      expect(env['COPILOT_MODEL']).toBe('gpt-5.4');
    });

    it('emits pinned model for Dalton from registry even when parent env vars are cleared', () => {
      const env = buildAgentEnvironment(daltonProfile, '/ctx', '/repo');
      expect(env['RUN_ROLE_AGENT_ACTIVE_MODEL']).toBe('gpt-4.1');
      expect(env['COPILOT_MODEL']).toBe('gpt-4.1');
    });

    it('throws role-registry-model-missing when requiredModel is empty', () => {
      const missingModelProfile: AgentProfile = {
        ...aliceProfile,
        requiredModel: '',
      };
      expect(() => buildAgentEnvironment(missingModelProfile, '/ctx', '/repo')).toThrow(
        /role-registry-model-missing/,
      );
    });
  });
});

describe('buildAutonomyEnvironment', () => {
  const profile: AgentProfile = {
    id: 'dalton',
    registryId: 'software-engineer',
    displayName: 'Dalton',
    role: 'Software Engineer',
    requiredModel: 'claude-sonnet-4.5',
    autonomyProfile: 'repo-executor',
    workflowOrder: 3,
  };

  const autonomyIntent: AutonomyIntent = {
    model: 'claude-sonnet-4.5',
    autonomyProfile: 'repo-executor',
    allowedDirs: ['/workspace/repo'],
    disallowTempDir: true,
  };

  const argsResult: BuildArgsResult = {
    args: [],
    launchCwd: '/workspace/repo',
    inlineAgentContext: false,
    resolvedToolPolicy: {
      allowAllTools: true,
      noAskUser: true,
      allowTools: ['editFiles'],
      denyTools: ['runCommand(rm -rf)'],
    },
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps focused targeting in autonomy metadata without provider env exports', () => {
    const focusedAutonomyIntent: AutonomyIntent = {
      ...autonomyIntent,
      allowedDirs: ['/workspace/repo', '/workspace/support'],
    };
    const externalMcpContext: ExternalMcpLaunchContext = {
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        EXTERNAL_MCP_CONTEXT_FILE: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      },
      launchDir: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch',
      resolvedServers: [],
      selectedServerIds: ['github'],
      excludedServerIds: ['slack'],
    };
    const env = buildAutonomyEnvironment(
      profile,
      focusedAutonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      {
        primaryRepoRoot: '/workspace/repo',
        visibleRepoRoots: ['/workspace/repo', '/workspace/support'],
        declaredRepoRoots: ['/workspace/repo', '/workspace/support'],
        estateType: 'monolith',
        primaryRepoId: 'monolith-app',
        primaryFocusId: 'api',
        primaryFocusRelativePath: 'apps/api',
        deepFocusEnabled: true,
        primaryFocusTargetKind: 'directory',
        testTarget: {
          path: 'tests/api',
          kind: 'directory',
          resolvedPath: '/workspace/repo/tests/api',
        },
        supportTargets: [
          { path: 'shared/types.ts', kind: 'file', effectiveScope: 'exact-file' },
        ],
        writableRoots: [
          { path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
          { path: 'tests/api', kind: 'directory', reason: 'test-target' },
        ],
        readonlyContextRoots: [
          { path: 'shared/types.ts', kind: 'file', reason: 'support-target' },
        ],
        warnings: ['Deep Focus test target "tests" is an ancestor of the primary target "tests/unit/handler.test.ts" and broadens the writable scope.'],
        selectedRepoIds: ['monolith-app', 'docs-site'],
        selectedFocusIds: ['web', 'api'],
        authoritySource: 'active-task-sidecar',
      },
      '/workspace/repo/context-pack',
      externalMcpContext,
    );
    const profileJson = JSON.parse(env['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON'] ?? '{}') as {
      boundary_context?: {
        allowed_roots?: string[];
        working_directory?: string;
        working_directory_kind?: string;
        warnings?: string[];
        writable_roots?: Array<{ path?: string; kind?: string; reason?: string }>;
        readonly_context_roots?: Array<{ path?: string; kind?: string; reason?: string }>;
        focused_targeting?: {
          primary_repo_root?: string;
          primary_repo_id?: string;
          visible_repo_roots?: string[];
          primary_focus_relative_path?: string | null;
          deep_focus_enabled?: boolean;
          primary_focus_target_kind?: string | null;
          test_target?: { path?: string; kind?: string } | null;
          support_targets?: Array<{ path?: string; kind?: string; effectiveScope?: string }>;
          writable_roots?: Array<{ path?: string; kind?: string; reason?: string }>;
          readonly_context_roots?: Array<{ path?: string; kind?: string; reason?: string }>;
          warnings?: string[];
        } | null;
      };
      external_mcp_context?: {
        status?: string;
        reason?: string;
        injectionEnabled?: boolean;
        selectedServerIds?: string[];
        excludedServerIds?: string[];
        contextFile?: string | null;
        cliHome?: string | null;
      };
    };

    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGET_KIND');
    expect(env).not.toHaveProperty('COPILOT_TEST_TARGET_PATH');
    expect(env).not.toHaveProperty('COPILOT_TEST_TARGET_KIND');
    expect(env).not.toHaveProperty('COPILOT_TARGET_REPOS_JSON');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR']).toBe('.');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND']).toBe('active-context-pack');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS']).toBe('resolved');
    expect(profileJson.boundary_context?.working_directory).toBe('.');
    expect(profileJson.boundary_context?.working_directory_kind).toBe('platform-repo-root');
    expect(profileJson.boundary_context?.selected_repo_ids).toEqual(['monolith-app', 'docs-site']);
    expect(profileJson.boundary_context?.selected_focus_ids).toEqual(['web', 'api']);
    expect(profileJson.boundary_context?.allowed_roots).toEqual(['/workspace/repo', '/workspace/support']);
    expect(profileJson.boundary_context?.target_folders).toEqual(['/workspace/repo', '/workspace/support']);
    expect(profileJson.boundary_context?.writable_roots).toEqual([
      { path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
      { path: 'tests/api', kind: 'directory', reason: 'test-target' },
    ]);
    expect(profileJson.boundary_context?.readonly_context_roots).toEqual([
      { path: 'shared/types.ts', kind: 'file', reason: 'support-target' },
    ]);
    expect(profileJson.boundary_context?.warnings).toEqual([
      'Deep Focus test target "tests" is an ancestor of the primary target "tests/unit/handler.test.ts" and broadens the writable scope.',
    ]);
    expect(profileJson.boundary_context?.focused_targeting).toEqual({
      primary_repo_root: '/workspace/repo',
      primary_repo_id: 'monolith-app',
      visible_repo_roots: ['/workspace/repo', '/workspace/support'],
      primary_focus_relative_path: 'apps/api',
      deep_focus_enabled: true,
      primary_focus_target_kind: 'directory',
      test_target: {
        path: 'tests/api',
        kind: 'directory',
      },
      support_targets: [
        { path: 'shared/types.ts', kind: 'file', effectiveScope: 'exact-file' },
      ],
      writable_roots: [
        { path: 'apps/api', kind: 'directory', reason: 'selected-primary' },
        { path: 'tests/api', kind: 'directory', reason: 'test-target' },
      ],
      readonly_context_roots: [
        { path: 'shared/types.ts', kind: 'file', reason: 'support-target' },
      ],
      warnings: [
        'Deep Focus test target "tests" is an ancestor of the primary target "tests/unit/handler.test.ts" and broadens the writable scope.',
      ],
    });
    expect(profileJson.external_mcp_context).toEqual({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      selectedServerIds: ['github'],
      excludedServerIds: ['slack'],
      contextFile: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      cliHome: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch',
    });
  });

  it('sets external MCP cliHome to null when launchDir is unavailable', () => {
    const externalMcpContext: ExternalMcpLaunchContext = {
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        EXTERNAL_MCP_CONTEXT_FILE: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      },
      selectedServerIds: ['github'],
      excludedServerIds: [],
      resolvedServers: [],
    };
    const env = buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      undefined,
      '/workspace/repo/context-pack',
      externalMcpContext,
    );
    const profileJson = JSON.parse(env['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON'] ?? '{}') as {
      external_mcp_context?: {
        status?: string;
        reason?: string;
        injectionEnabled?: boolean;
        selectedServerIds?: string[];
        excludedServerIds?: string[];
        contextFile?: string | null;
        cliHome?: string | null;
      };
    };

    expect(profileJson.external_mcp_context).toEqual({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      selectedServerIds: ['github'],
      excludedServerIds: [],
      contextFile: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      cliHome: null,
    });
  });

  it('omits COPILOT_PRIMARY_FOCUS_PATH when no monolith focus path is resolved', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      {
        primaryRepoRoot: '/workspace/repo',
        visibleRepoRoots: ['/workspace/repo'],
        declaredRepoRoots: ['/workspace/repo'],
        estateType: 'monolith',
        primaryRepoId: 'monolith-app',
        selectedRepoIds: ['monolith-app'],
        selectedFocusIds: [],
        authoritySource: 'workspace-sync-state',
      },
      '/workspace/repo/context-pack',
    );

    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGET_KIND');
    expect(env).not.toHaveProperty('COPILOT_TEST_TARGET_PATH');
    expect(env).not.toHaveProperty('COPILOT_TEST_TARGET_KIND');
  });

  it('preserves repo-root Deep Focus metadata without exporting a fabricated target kind', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      {
        primaryRepoRoot: '/workspace/repo',
        visibleRepoRoots: ['/workspace/repo'],
        declaredRepoRoots: ['/workspace/repo'],
        estateType: 'monolith',
        primaryRepoId: 'monolith-app',
        primaryFocusRelativePath: '',
        deepFocusEnabled: true,
        selectedRepoIds: ['monolith-app'],
        selectedFocusIds: ['api'],
        authoritySource: 'active-task-sidecar',
      },
      '/workspace/repo/context-pack',
    );
    const profileJson = JSON.parse(env['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON'] ?? '{}') as {
      boundary_context?: {
        focused_targeting?: {
          primary_focus_relative_path?: string | null;
          primary_focus_target_kind?: string | null;
        } | null;
      };
    };

    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_TARGET_KIND');
    expect(profileJson.boundary_context?.focused_targeting).toEqual(expect.objectContaining({
      primary_focus_relative_path: '',
      primary_focus_target_kind: null,
    }));
  });

  it('omits focused targeting exports but preserves platform-root launch metadata when focused resolution is unavailable', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      undefined,
      '/workspace/repo/context-pack',
    );
    const profileJson = JSON.parse(env['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON'] ?? '{}') as {
      boundary_context?: {
        mode?: string;
        working_directory?: string;
        working_directory_kind?: string;
        scope_mode?: string | null;
        selected_repo_ids?: string[];
        target_folders?: string[];
        focused_targeting?: unknown;
      };
    };

    expect(env).not.toHaveProperty('COPILOT_TARGET_REPOS_JSON');
    expect(env).not.toHaveProperty('COPILOT_PRIMARY_FOCUS_PATH');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR']).toBe('.');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND']).toBe('active-context-pack');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS']).toBe('resolved');
    expect(profileJson.boundary_context).toEqual(expect.objectContaining({
      mode: 'active-context-pack',
      working_directory: '.',
      working_directory_kind: 'platform-repo-root',
      scope_mode: null,
      selected_repo_ids: [],
      target_folders: [],
      focused_targeting: null,
    }));
  });

  it('omits external MCP metadata when launch context is not provided', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyIntent,
      argsResult,
      '/workspace/repo',
      '/workspace/repo',
      undefined,
      '/workspace/repo/context-pack',
    );
    const profileJson = JSON.parse(env['RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON'] ?? '{}') as {
      external_mcp_context?: unknown;
    };

    expect(profileJson.external_mcp_context).toBeUndefined();
  });
});
