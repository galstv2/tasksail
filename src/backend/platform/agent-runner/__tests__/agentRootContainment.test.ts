import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertNoOriginalTargetRootsInAgentLaunch,
  assertNoOriginalTargetRootsInTaskArtifacts,
  projectAgentRepoBindings,
} from '../agentRootContainment.js';
import type { TaskReadonlyContextBinding, TaskRepoBinding } from '../../queue/taskJson.js';

describe('agent root containment', () => {
  const binding: TaskRepoBinding = {
    originalRoot: '/repo/live/tools',
    worktreeRoot: '/repo/task/worktrees/tools',
    worktreeBranch: 'task/example',
    baseCommitSha: 'abc123',
  };
  const readonlyBinding: TaskReadonlyContextBinding = {
    originalRoot: '/repo/live/docs',
    worktreeRoot: '/repo/task/worktrees/docs',
    baseCommitSha: 'def456',
    repoId: 'docs',
    role: 'support',
  };

  it('rejects original roots in launch cwd, allowed dirs, env, focused metadata, and MCP payloads', () => {
    expect(() => assertNoOriginalTargetRootsInAgentLaunch({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [binding],
      platformRepoRoot: '/repo/platform',
      surface: {
        agentCwd: '/repo/task/worktrees/tools',
        allowedDirs: ['/repo/task/worktrees/tools'],
        env: { COPILOT_TARGET_REPOS_JSON: JSON.stringify(['/repo/live/tools']) },
      },
    })).toThrow('env.COPILOT_TARGET_REPOS_JSON contains selected original root');
  });

  it('allows corresponding worktree roots', () => {
    expect(() => assertNoOriginalTargetRootsInAgentLaunch({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [binding],
      platformRepoRoot: '/repo/platform',
      surface: {
        agentCwd: '/repo/task/worktrees/tools',
        allowedDirs: ['/repo/task/worktrees/tools'],
        env: { COPILOT_TARGET_REPOS_JSON: JSON.stringify(['/repo/task/worktrees/tools']) },
      },
    })).not.toThrow();
  });

  it('projects agent repo bindings without original roots', () => {
    expect(projectAgentRepoBindings({ repoBindings: [binding] })).toEqual([{
      repoId: 'tools',
      role: 'primary',
      worktreeRoot: '/repo/task/worktrees/tools',
      branch: 'task/example',
    }]);
  });

  it('validates readonly context roots as task-visible launch roots', () => {
    expect(() => assertNoOriginalTargetRootsInAgentLaunch({
      taskId: 'task-1',
      agentId: 'ron',
      repoBindings: [binding],
      readonlyContextBindings: [readonlyBinding],
      platformRepoRoot: '/repo/platform',
      surface: {
        agentCwd: '/repo/task/worktrees/tools',
        allowedDirs: ['/repo/task/worktrees/tools', '/repo/live/docs'],
        env: {},
      },
    })).toThrow('allowedDirs[1] contains selected original root');
  });

  it('loads readonly context roots from the task sidecar when callers pass branch bindings only', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'agent-containment-readonly-'));
    const taskId = 'task-1';
    try {
      const taskDir = path.join(repoRoot, 'AgentWorkSpace', 'tasks', taskId);
      mkdirSync(taskDir, { recursive: true });
      writeFileSync(path.join(taskDir, '.task.json'), JSON.stringify({
        schema_version: 2,
        taskId,
        contextPackBinding: {
          contextPackPath: null,
          dataHostDir: null,
          dataContainerDir: null,
          repoBindings: [binding],
          readonlyContextBindings: [readonlyBinding],
        },
        materialization: { strategy: 'copy', cloned: [], skipped: [] },
        frozenAt: '2026-01-01T00:00:00Z',
        finalizedAt: null,
        state: 'active',
      }));

      expect(() => assertNoOriginalTargetRootsInAgentLaunch({
        taskId,
        agentId: 'ron',
        repoBindings: [binding],
        platformRepoRoot: repoRoot,
        surface: {
          agentCwd: '/repo/task/worktrees/tools',
          allowedDirs: ['/repo/task/worktrees/tools'],
          env: { COPILOT_TARGET_REPOS_JSON: JSON.stringify(['/repo/live/docs']) },
        },
      })).toThrow('env.COPILOT_TARGET_REPOS_JSON contains selected original root');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('validates readonly context roots in task artifacts', () => {
    expect(() => assertNoOriginalTargetRootsInTaskArtifacts({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [binding],
      readonlyContextBindings: [readonlyBinding],
      platformRepoRoot: '/repo/platform',
      artifacts: [{
        path: '/repo/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
        category: 'implementation-spec',
        content: 'Inspect support context at /repo/live/docs.',
      }],
    })).toThrow('implementation-spec artifact');
  });

  it('allows platform-owned paths when the selected original root is the platform repo', () => {
    const platformBinding = { ...binding, originalRoot: '/repo/platform', worktreeRoot: '/repo/AgentWorkSpace/tasks/task-1/worktrees/platform' };
    expect(() => assertNoOriginalTargetRootsInAgentLaunch({
      taskId: 'task-1',
      agentId: 'alice',
      repoBindings: [platformBinding],
      platformRepoRoot: '/repo/platform',
      contextPackDir: '/repo/platform/contextpacks/orders',
      surface: {
        agentCwd: '/repo/AgentWorkSpace/tasks/task-1',
        allowedDirs: [
          '/repo/platform/AgentWorkSpace/tasks/task-1',
          '/repo/platform/AgentWorkSpace/templates',
          '/repo/platform/AgentWorkSpace/qmd',
          '/repo/platform/.platform-state/runtime/tasks/task-1',
          '/repo/platform/contextpacks/orders',
        ],
        env: {
          COPILOT_HANDOFFS_DIR: '/repo/platform/AgentWorkSpace/tasks/task-1/handoffs',
          ACTIVE_CONTEXT_PACK_DIR: '/repo/platform/contextpacks/orders',
        },
      },
    })).not.toThrow();
  });

  it('still rejects selected source paths under the platform root', () => {
    const platformBinding = { ...binding, originalRoot: '/repo/platform', worktreeRoot: '/repo/AgentWorkSpace/tasks/task-1/worktrees/platform' };
    expect(() => assertNoOriginalTargetRootsInAgentLaunch({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [platformBinding],
      platformRepoRoot: '/repo/platform',
      surface: {
        agentCwd: '/repo/AgentWorkSpace/tasks/task-1/worktrees/platform',
        allowedDirs: ['/repo/platform/src'],
        env: {},
      },
    })).toThrow('allowedDirs[0] contains selected original root');
  });

  it('rejects selected original roots in Alice-authored artifacts before Dalton launch', () => {
    expect(() => assertNoOriginalTargetRootsInTaskArtifacts({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [binding],
      platformRepoRoot: '/repo/platform',
      artifacts: [{
        path: '/repo/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
        category: 'implementation-spec',
        content: 'Run tests from /repo/live/tools.',
      }],
    })).toThrow('implementation-spec artifact');
  });

  it('allows worktree and repo-relative paths in Alice-authored artifacts', () => {
    expect(() => assertNoOriginalTargetRootsInTaskArtifacts({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [binding],
      platformRepoRoot: '/repo/platform',
      artifacts: [
        {
          path: '/repo/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
          category: 'implementation-spec',
          content: 'Run tests from /repo/task/worktrees/tools.',
        },
        {
          path: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps/slice-1.md',
          category: 'implementation-step',
          content: 'Edit tools/Acme.Cli/Program.cs.',
        },
      ],
    })).not.toThrow();
  });

  it('allows platform-owned paths in Alice-authored artifacts when platform repo is selected', () => {
    expect(() => assertNoOriginalTargetRootsInTaskArtifacts({
      taskId: 'task-1',
      agentId: 'dalton',
      repoBindings: [{
        originalRoot: '/repo/platform',
        worktreeRoot: '/repo/platform/AgentWorkSpace/tasks/task-1/worktrees/platform',
        worktreeBranch: 'task/task-1/platform',
        baseCommitSha: 'abc',
      }],
      platformRepoRoot: '/repo/platform',
      contextPackDir: '/repo/platform/contextpacks/orders',
      artifacts: [{
        path: '/repo/platform/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
        category: 'implementation-spec',
        content: [
          'Use /repo/platform/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
          'and /repo/platform/contextpacks/orders/qmd/repo-sources.json.',
        ].join('\n'),
      }],
    })).not.toThrow();
  });

  it('rejects platform-owned sibling prefix paths in Alice-authored artifacts', () => {
    const platformBinding: TaskRepoBinding = {
      originalRoot: '/repo/platform',
      worktreeRoot: '/repo/platform/AgentWorkSpace/tasks/task-1/worktrees/platform',
      worktreeBranch: 'task/task-1/platform',
      baseCommitSha: 'abc',
    };
    const siblingPaths = [
      '/repo/platform/AgentWorkSpace/tasks/task-1-other/handoffs/implementation-spec.md',
      '/repo/platform/AgentWorkSpace/tasks/task-1.other/handoffs/implementation-spec.md',
      '/repo/platform/.platform-state/runtime/tasks/task-1-other/session.json',
      '/repo/platform/.platform-state/runtime/tasks/task-1.other/session.json',
      '/repo/platform/contextpacks/orders-old/qmd/repo-sources.json',
      '/repo/platform/contextpacks/orders.old/qmd/repo-sources.json',
    ];

    for (const siblingPath of siblingPaths) {
      expect(() => assertNoOriginalTargetRootsInTaskArtifacts({
        taskId: 'task-1',
        agentId: 'dalton',
        repoBindings: [platformBinding],
        platformRepoRoot: '/repo/platform',
        contextPackDir: '/repo/platform/contextpacks/orders',
        artifacts: [{
          path: '/repo/platform/AgentWorkSpace/tasks/task-1/handoffs/implementation-spec.md',
          category: 'implementation-spec',
          content: `Use ${siblingPath}.`,
        }],
      })).toThrow('implementation-spec artifact');
    }
  });
});
