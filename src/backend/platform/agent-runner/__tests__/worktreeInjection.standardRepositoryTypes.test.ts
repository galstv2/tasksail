import { describe, expect, it } from 'vitest';
import { applyWorktreeInjectionToFocused, type WorktreeBindingMap } from '../worktreeInjection.js';

describe('worktree injection standard repositoryTypes writable roots', () => {
  it('rewrites multiple standard writable repo roots to task worktrees', () => {
    const map: WorktreeBindingMap = {
      applied: true,
      substitutions: new Map([
        ['/repos/platform', '/tasks/worktrees/platform'],
        ['/repos/tools', '/tasks/worktrees/tools'],
      ]),
    };

    const focused = applyWorktreeInjectionToFocused({
      primaryRepoRoot: '/repos/platform',
      visibleRepoRoots: ['/repos/platform', '/repos/tools'],
      declaredRepoRoots: ['/repos/platform', '/repos/tools'],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      selectedRepoIds: ['platform', 'tools'],
      selectedFocusIds: [],
      writableRoots: [
        { repoLocalPath: '/repos/platform', path: '', kind: 'directory', reason: 'selected-primary' },
        { repoLocalPath: '/repos/tools', path: '', kind: 'directory', reason: 'selected-primary' },
      ],
      readonlyContextRoots: [],
      authoritySource: 'active-task-sidecar',
    }, map);

    expect(focused.writableRoots).toEqual([
      { repoLocalPath: '/tasks/worktrees/platform', path: '', kind: 'directory', reason: 'selected-primary' },
      { repoLocalPath: '/tasks/worktrees/tools', path: '', kind: 'directory', reason: 'selected-primary' },
    ]);
    expect(focused.visibleRepoRoots).toEqual(['/tasks/worktrees/platform', '/tasks/worktrees/tools']);
  });
});
