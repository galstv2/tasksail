import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DaltonConfinementError,
  validateDaltonBoundaryChanges,
} from '../confinement.js';
import { buildDaltonConfinementRetryPrompt } from '../daltonLaunchPrep.js';
import { applyWorktreeInjectionToFocused, type WorktreeBindingMap } from '../worktreeInjection.js';
import type { FocusedRepoResult } from '../../context-pack/focusedRepo.js';

function createTempWorkspace(): {
  root: string;
  platformRepoRoot: string;
  primaryRepoRoot: string;
  sharedRepoRoot: string;
  monolithRepoRoot: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), 'tasksail-confinement-'));
  const platformRepoRoot = path.join(root, 'platform');
  const primaryRepoRoot = path.join(root, 'crud-app');
  const sharedRepoRoot = path.join(root, 'shared-lib');
  const monolithRepoRoot = path.join(root, 'monolith');
  mkdirSync(platformRepoRoot, { recursive: true });
  mkdirSync(primaryRepoRoot, { recursive: true });
  mkdirSync(sharedRepoRoot, { recursive: true });
  mkdirSync(monolithRepoRoot, { recursive: true });
  return { root, platformRepoRoot, primaryRepoRoot, sharedRepoRoot, monolithRepoRoot };
}

function writeChangedFile(repoRoot: string, relativePath: string): string {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, 'changed');
  return absolutePath;
}

describe('validateDaltonBoundaryChanges', () => {
  it('allows selected primary repo edits but rejects platform writes when platform is not writable authority', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['src/app.ts'],
            [workspace.sharedRepoRoot]: [],
          },
        },
      })).resolves.toBeUndefined();

      writeChangedFile(workspace.platformRepoRoot, 'AgentWorkSpace/tasks/task-test-001/handoffs/issues.md');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
            [workspace.primaryRepoRoot]: ['src/app.ts'],
            [workspace.sharedRepoRoot]: [],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('allows platform repo edits inside selected writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.platformRepoRoot,
          visibleRepoRoots: [workspace.platformRepoRoot],
          declaredRepoRoots: [workspace.platformRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'platform',
          writableRoots: [
            {
              repoLocalPath: workspace.platformRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'selected-primary',
            },
          ],
          selectedRepoIds: ['platform'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects selected platform repo edits outside path-scoped writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.platformRepoRoot, 'AgentWorkSpace/tasks/task-test-001/handoffs/issues.md');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.platformRepoRoot,
          visibleRepoRoots: [workspace.platformRepoRoot],
          declaredRepoRoots: [workspace.platformRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'platform',
          writableRoots: [
            {
              repoLocalPath: workspace.platformRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'selected-primary',
            },
          ],
          selectedRepoIds: ['platform'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects platform repo edits when platform is visible read-only context only', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.platformRepoRoot, 'src/backend/platform.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot, workspace.platformRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.platformRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          writableRoots: [
            {
              repoLocalPath: workspace.primaryRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'selected-primary',
            },
          ],
          readonlyContextRoots: [
            {
              repoLocalPath: workspace.platformRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'support-target',
            },
          ],
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
            [workspace.primaryRepoRoot]: [],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('preserves legacy platform primary fallback when writable roots are absent', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.platformRepoRoot,
          visibleRepoRoots: [workspace.platformRepoRoot],
          declaredRepoRoots: [workspace.platformRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'platform',
          primaryFocusRelativePath: 'src',
          primaryFocusTargetKind: 'directory',
          selectedRepoIds: ['platform'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('uses standard mode writable roots for platform primary authority while rejecting support repos', async () => {
    const workspace = createTempWorkspace();
    const focused: FocusedRepoResult = {
      primaryRepoRoot: workspace.platformRepoRoot,
      visibleRepoRoots: [workspace.platformRepoRoot, workspace.sharedRepoRoot],
      declaredRepoRoots: [workspace.platformRepoRoot, workspace.sharedRepoRoot],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      writableRoots: [
        {
          repoLocalPath: workspace.platformRepoRoot,
          path: 'src',
          kind: 'directory',
          reason: 'selected-primary',
        },
      ],
      readonlyContextRoots: [
        {
          repoLocalPath: workspace.sharedRepoRoot,
          path: 'src',
          kind: 'directory',
          reason: 'support-target',
        },
      ],
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    };

    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
            [workspace.sharedRepoRoot]: [],
          },
        },
      })).resolves.toBeUndefined();

      writeChangedFile(workspace.sharedRepoRoot, 'src/support.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
            [workspace.sharedRepoRoot]: ['src/support.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('uses deep focus writable roots for platform primary targets while rejecting support targets', async () => {
    const workspace = createTempWorkspace();
    const focused: FocusedRepoResult = {
      primaryRepoRoot: workspace.platformRepoRoot,
      visibleRepoRoots: [workspace.platformRepoRoot, workspace.sharedRepoRoot],
      declaredRepoRoots: [workspace.platformRepoRoot, workspace.sharedRepoRoot],
      estateType: 'distributed-platform',
      primaryRepoId: 'platform',
      deepFocusEnabled: true,
      primaryFocusTargets: [
        {
          path: 'src',
          kind: 'directory',
          role: 'primary',
          repoLocalPath: workspace.platformRepoRoot,
          repoId: 'platform',
        },
      ],
      writableRoots: [
        {
          repoLocalPath: workspace.platformRepoRoot,
          path: 'src',
          kind: 'directory',
          reason: 'selected-primary',
        },
      ],
      readonlyContextRoots: [
        {
          repoLocalPath: workspace.sharedRepoRoot,
          path: 'src',
          kind: 'directory',
          reason: 'support-target',
        },
      ],
      selectedRepoIds: ['platform'],
      selectedFocusIds: [],
      authoritySource: 'active-task-sidecar',
    };

    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
            [workspace.sharedRepoRoot]: [],
          },
        },
      })).resolves.toBeUndefined();

      writeChangedFile(workspace.sharedRepoRoot, 'src/support.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['src/backend/platform.ts'],
            [workspace.sharedRepoRoot]: ['src/support.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('accepts incident-shaped worktree edits after injection and rejects siblings outside writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      const originRoot = path.join(workspace.root, 'origin', 'platform');
      const worktreeRoot = path.join(workspace.root, 'task', 'worktrees', 'platform');
      mkdirSync(originRoot, { recursive: true });
      mkdirSync(worktreeRoot, { recursive: true });
      writeChangedFile(worktreeRoot, 'libs/Acme.Models/Order.cs');
      writeChangedFile(worktreeRoot, 'libs/Acme.Models.Tests/OrderTests.cs');
      writeChangedFile(worktreeRoot, 'libs/Acme.Sibling/Leak.cs');

      const bindingMap: WorktreeBindingMap = {
        applied: true,
        substitutions: new Map([[originRoot, worktreeRoot]]),
      };
      const focused = applyWorktreeInjectionToFocused({
        primaryRepoRoot: originRoot,
        visibleRepoRoots: [originRoot],
        declaredRepoRoots: [originRoot],
        estateType: 'distributed-platform',
        primaryRepoId: 'platform',
        writableRoots: [
          {
            repoLocalPath: originRoot,
            path: 'libs/Acme.Models',
            kind: 'directory',
            reason: 'selected-primary',
          },
          {
            repoLocalPath: originRoot,
            path: 'libs/Acme.Models.Tests',
            kind: 'directory',
            reason: 'scoped-test-target',
          },
        ],
        selectedRepoIds: ['platform'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      }, bindingMap);

      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [worktreeRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [worktreeRoot]: [
              'libs/Acme.Models/Order.cs',
              'libs/Acme.Models.Tests/OrderTests.cs',
            ],
          },
        },
      })).resolves.toBeUndefined();

      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused,
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [worktreeRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [worktreeRoot]: ['libs/Acme.Sibling/Leak.cs'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects distributed edits in non-primary repos', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.sharedRepoRoot, 'src/leak.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: ['src/leak.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('allows non-anchor visible repo edits inside matching writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusTargets: [
            {
              path: '',
              kind: 'directory',
              role: 'anchor',
              repoLocalPath: workspace.primaryRepoRoot,
              repoId: 'crud-app',
            },
            {
              path: 'src',
              kind: 'directory',
              role: 'primary',
              repoLocalPath: workspace.sharedRepoRoot,
              repoId: 'shared-lib',
            },
          ],
          writableRoots: [
            {
              repoLocalPath: workspace.primaryRepoRoot,
              path: '',
              kind: 'directory',
              reason: 'selected-primary',
            },
            {
              repoLocalPath: workspace.sharedRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'selected-primary',
            },
          ],
          selectedRepoIds: ['crud-app', 'shared-lib'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: ['src/index.ts'],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects non-anchor visible repo edits outside matching writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.sharedRepoRoot, 'docs/leak.md');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          writableRoots: [
            {
              repoLocalPath: workspace.sharedRepoRoot,
              path: 'src',
              kind: 'directory',
              reason: 'selected-primary',
            },
          ],
          selectedRepoIds: ['crud-app', 'shared-lib'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: ['docs/leak.md'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects repo roots outside primary and visible repo roots when writable roots are absent', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.monolithRepoRoot, 'src/leak.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot, workspace.monolithRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app', 'shared-lib'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
            [workspace.monolithRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
            [workspace.monolithRepoRoot]: ['src/leak.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects traversal attempts before matching writable roots', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.primaryRepoRoot, '../shared-lib/leak.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot, workspace.sharedRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          writableRoots: [
            { path: '', kind: 'directory', reason: 'selected-primary' },
          ],
          selectedRepoIds: ['crud-app', 'shared-lib'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
            [workspace.sharedRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['../shared-lib/leak.ts'],
            [workspace.sharedRepoRoot]: [],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects monolith edits outside the selected primary focus path', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.monolithRepoRoot, 'apps/web/page.tsx');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.monolithRepoRoot,
          visibleRepoRoots: [workspace.monolithRepoRoot],
          declaredRepoRoots: [workspace.monolithRepoRoot],
          estateType: 'monolith',
          primaryRepoId: 'monolith-app',
          primaryFocusId: 'api',
          primaryFocusRelativePath: 'apps/api',
          selectedRepoIds: ['monolith-app'],
          selectedFocusIds: ['api'],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.monolithRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.monolithRepoRoot]: ['apps/web/page.tsx'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('allows file focus writes within the selected file parent directory', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.primaryRepoRoot, 'src/handler.tsx');
      writeChangedFile(workspace.primaryRepoRoot, 'src/helpers/util.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'src/handler.ts',
          primaryFocusTargetKind: 'file',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['src/handler.tsx', 'src/helpers/util.ts'],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects file focus writes outside the selected file parent directory', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.primaryRepoRoot, 'other/handler.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'src/handler.ts',
          primaryFocusTargetKind: 'file',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['other/handler.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('uses derived writable roots while rejecting read-only support roots for the Acme routes file focus', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.primaryRepoRoot, 'libs/Acme.Models/Order.cs');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
          primaryFocusTargetKind: 'file',
          writableRoots: [
            { path: 'services/Acme.Api', kind: 'directory', reason: 'primary-focus-parent' },
            { path: 'services/Acme.Api.Tests', kind: 'directory', reason: 'test-target' },
          ],
          readonlyContextRoots: [
            { path: 'libs/Acme.Models', kind: 'directory', reason: 'support-target' },
          ],
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [
              'services/Acme.Api/Routes.cs',
              'services/Acme.Api/App.cs',
              'services/Acme.Api/Handlers/OrderHandlers.cs',
              'services/Acme.Api.Tests/RoutesTests.cs',
              'libs/Acme.Models/Order.cs',
            ],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);

      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'services/Acme.Api/Routes.cs',
          primaryFocusTargetKind: 'file',
          writableRoots: [
            { path: 'services/Acme.Api', kind: 'directory', reason: 'primary-focus-parent' },
            { path: 'services/Acme.Api.Tests', kind: 'directory', reason: 'test-target' },
          ],
          readonlyContextRoots: [
            { path: 'libs/Acme.Models', kind: 'directory', reason: 'support-target' },
          ],
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [
              'services/Acme.Api/Routes.cs',
              'services/Acme.Api/App.cs',
              'services/Acme.Api/Handlers/OrderHandlers.cs',
              'services/Acme.Api.Tests/RoutesTests.cs',
            ],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('keeps parent support read-only when a child folder is the writable primary target', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'src/app',
          primaryFocusTargetKind: 'directory',
          writableRoots: [
            { path: 'src/app', kind: 'directory', reason: 'selected-primary' },
          ],
          readonlyContextRoots: [
            { path: 'src', kind: 'directory', reason: 'scoped-support-target' },
          ],
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['src/app/handler.ts'],
          },
        },
      })).resolves.toBeUndefined();

      writeChangedFile(workspace.primaryRepoRoot, 'src/shared/read-model.ts');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'src/app',
          primaryFocusTargetKind: 'directory',
          writableRoots: [
            { path: 'src/app', kind: 'directory', reason: 'selected-primary' },
          ],
          readonlyContextRoots: [
            { path: 'src', kind: 'directory', reason: 'scoped-support-target' },
          ],
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['src/shared/read-model.ts'],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('allows writes inside the test target boundary without widening primary writes', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'distributed-platform',
          primaryRepoId: 'crud-app',
          primaryFocusRelativePath: 'src/handler.ts',
          primaryFocusTargetKind: 'file',
          testTarget: {
            path: 'tests/unit',
            kind: 'directory',
            resolvedPath: path.join(workspace.primaryRepoRoot, 'tests/unit'),
          },
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: ['tests/unit/handler.test.ts'],
          },
        },
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects platform writes to testing skip receipts', async () => {
    const workspace = createTempWorkspace();
    try {
      writeChangedFile(workspace.platformRepoRoot, '.platform-state/runtime/guardrails/testing-skip.json');
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['.platform-state/runtime/guardrails/testing-skip.json'],
            [workspace.primaryRepoRoot]: [],
          },
        },
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('skips out-of-bound candidates older than the agent spawn timestamp', async () => {
    const workspace = createTempWorkspace();
    try {
      const agentSpawnedAtMs = Date.now();
      const violationPath = writeChangedFile(workspace.platformRepoRoot, 'AgentWorkSpace/tasks/task-test-001/handoffs/issues.md');
      const olderThanSpawn = new Date(agentSpawnedAtMs - 10_000);
      utimesSync(violationPath, olderThanSpawn, olderThanSpawn);

      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
            [workspace.primaryRepoRoot]: [],
          },
        },
        agentSpawnedAtMs,
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('rejects out-of-bound candidates newer than the agent spawn timestamp', async () => {
    const workspace = createTempWorkspace();
    try {
      const agentSpawnedAtMs = Date.now();
      const violationPath = writeChangedFile(workspace.platformRepoRoot, 'AgentWorkSpace/tasks/task-test-001/handoffs/issues.md');
      const newerThanSpawn = new Date(agentSpawnedAtMs + 10_000);
      utimesSync(violationPath, newerThanSpawn, newerThanSpawn);

      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
            [workspace.primaryRepoRoot]: [],
          },
        },
        agentSpawnedAtMs,
      })).rejects.toThrow(DaltonConfinementError);
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });

  it('skips out-of-bound candidates that disappear before stat', async () => {
    const workspace = createTempWorkspace();
    try {
      await expect(validateDaltonBoundaryChanges({
        platformRepoRoot: workspace.platformRepoRoot,
        focused: {
          primaryRepoRoot: workspace.primaryRepoRoot,
          visibleRepoRoots: [workspace.primaryRepoRoot],
          declaredRepoRoots: [workspace.primaryRepoRoot],
          estateType: 'single-repo',
          primaryRepoId: 'crud-app',
          selectedRepoIds: ['crud-app'],
          selectedFocusIds: [],
          authoritySource: 'active-task-sidecar',
        },
        before: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: [],
            [workspace.primaryRepoRoot]: [],
          },
        },
        after: {
          byRepoRoot: {
            [workspace.platformRepoRoot]: ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
            [workspace.primaryRepoRoot]: [],
          },
        },
        agentSpawnedAtMs: Date.now(),
      })).resolves.toBeUndefined();
    } finally {
      await rm(workspace.root, { recursive: true, force: true });
    }
  });
});

describe('buildDaltonConfinementRetryPrompt', () => {
  const focused: FocusedRepoResult = {
    primaryRepoRoot: '/repo/worktree',
    visibleRepoRoots: ['/repo/worktree'],
    declaredRepoRoots: ['/repo/worktree'],
    estateType: 'distributed-platform',
    primaryRepoId: 'platform',
    selectedRepoIds: ['platform'],
    selectedFocusIds: [],
    authoritySource: 'active-task-sidecar',
    writableRoots: [
      {
        repoLocalPath: '/repo/worktree',
        path: 'libs/Acme.Models',
        kind: 'directory',
        reason: 'selected-primary',
      },
    ],
    readonlyContextRoots: [
      {
        repoLocalPath: '/repo/worktree',
        path: 'libs/Acme.Shared',
        kind: 'directory',
        reason: 'support-target',
      },
    ],
  };

  it('includes retry repair instructions and the original assignment context', () => {
    const prompt = buildDaltonConfinementRetryPrompt({
      basePrompt: 'Base retry prompt.',
      originalAssignmentPrompt: '## Implementation Spec\n\nDo the assigned work.\n\n### Slice: slice-1\n\nAcceptance Criteria.',
      violation: new DaltonConfinementError('outside boundary', [
        '/repo/worktree/libs/Acme.Sibling/Leak.cs',
      ]),
      focused,
    });

    expect(prompt).toContain('Base retry prompt.');
    expect(prompt).toContain('Out-of-bound changed paths detected:');
    expect(prompt).toContain('- /repo/worktree/libs/Acme.Sibling/Leak.cs');
    expect(prompt).toContain('You are a fresh independent Dalton process.');
    expect(prompt).toContain('Compare the current codebase state to the original assignment context below.');
    expect(prompt).toContain(`Writable roots: ${JSON.stringify(focused.writableRoots ?? [])}`);
    expect(prompt).toContain(`Read-only context roots: ${JSON.stringify(focused.readonlyContextRoots ?? [])}`);
    expect(prompt).toContain('## Original Assignment Context');
    expect(prompt).toContain('## Implementation Spec');
    expect(prompt).toContain('### Slice: slice-1');
  });

  it('fails closed when the original assignment prompt is blank', () => {
    expect(() => buildDaltonConfinementRetryPrompt({
      basePrompt: 'Base retry prompt.',
      originalAssignmentPrompt: '   ',
      violation: new DaltonConfinementError('outside boundary', []),
      focused,
    })).toThrow('original assignment prompt is empty');
  });
});
