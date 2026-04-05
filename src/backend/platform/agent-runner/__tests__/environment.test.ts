import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildAgentEnvironment, buildAutonomyEnvironment } from '../environment.js';
import type { AgentProfile, CopilotArgs } from '../types.js';
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

  const autonomyArgs: CopilotArgs = {
    model: 'claude-sonnet-4.5',
    allowTools: ['editFiles'],
    denyTools: ['runCommand(rm -rf)'],
    allowedDirs: ['/workspace/repo'],
    additionalFlags: ['--allow-all-tools'],
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes COPILOT_PRIMARY_FOCUS_PATH when focused repo declares one', () => {
    const focusedAutonomyArgs: CopilotArgs = {
      ...autonomyArgs,
      allowedDirs: ['/workspace/repo', '/workspace/support'],
    };
    const externalMcpContext: ExternalMcpLaunchContext = {
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      envExports: {
        COPILOT_HOME: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch',
        EXTERNAL_MCP_CONTEXT_FILE: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      },
      selectedServerIds: ['github'],
      excludedServerIds: ['slack'],
    };
    const env = buildAutonomyEnvironment(
      profile,
      focusedAutonomyArgs,
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
        focused_targeting?: {
          primary_repo_root?: string;
          primary_repo_id?: string;
          visible_repo_roots?: string[];
          primary_focus_relative_path?: string | null;
        } | null;
      };
      external_mcp_context?: {
        status?: string;
        reason?: string;
        injectionEnabled?: boolean;
        selectedServerIds?: string[];
        excludedServerIds?: string[];
        contextFile?: string | null;
        copilotHome?: string | null;
      };
    };

    expect(env['COPILOT_PRIMARY_FOCUS_PATH']).toBe('apps/api');
    expect(env['COPILOT_TARGET_REPOS_JSON']).toBe(JSON.stringify(['/workspace/repo', '/workspace/support']));
    expect(env['RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR']).toBe('.');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_KIND']).toBe('active-context-pack');
    expect(env['RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS']).toBe('resolved');
    expect(profileJson.boundary_context?.working_directory).toBe('.');
    expect(profileJson.boundary_context?.working_directory_kind).toBe('platform-repo-root');
    expect(profileJson.boundary_context?.selected_repo_ids).toEqual(['monolith-app', 'docs-site']);
    expect(profileJson.boundary_context?.selected_focus_ids).toEqual(['web', 'api']);
    expect(profileJson.boundary_context?.allowed_roots).toEqual(['/workspace/repo', '/workspace/support']);
    expect(profileJson.boundary_context?.target_folders).toEqual(['/workspace/repo', '/workspace/support']);
    expect(profileJson.boundary_context?.focused_targeting).toEqual({
      primary_repo_root: '/workspace/repo',
      primary_repo_id: 'monolith-app',
      visible_repo_roots: ['/workspace/repo', '/workspace/support'],
      primary_focus_relative_path: 'apps/api',
    });
    expect(profileJson.external_mcp_context).toEqual({
      status: 'available',
      reason: '1 external MCP server(s) injected',
      injectionEnabled: true,
      selectedServerIds: ['github'],
      excludedServerIds: ['slack'],
      contextFile: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch/mcp-capability-summary.md',
      copilotHome: '/workspace/repo/.platform-state/runtime/copilot-home/dalton-launch',
    });
  });

  it('omits COPILOT_PRIMARY_FOCUS_PATH when no monolith focus path is resolved', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyArgs,
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
  });

  it('omits focused targeting exports but preserves platform-root launch metadata when focused resolution is unavailable', () => {
    const env = buildAutonomyEnvironment(
      profile,
      autonomyArgs,
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
      autonomyArgs,
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
