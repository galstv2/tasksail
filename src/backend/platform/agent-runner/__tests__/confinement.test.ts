import { describe, expect, it } from 'vitest';
import {
  DaltonConfinementError,
  validateDaltonBoundaryChanges,
} from '../confinement.js';

describe('validateDaltonBoundaryChanges', () => {
  it('allows selected primary repo edits but rejects all platform writes', () => {
    // Primary repo edits are allowed
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
        estateType: 'distributed-platform',
        primaryRepoId: 'crud-app',
        selectedRepoIds: ['crud-app'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
      before: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
          '/repos/shared-lib': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': ['src/app.ts'],
          '/repos/shared-lib': [],
        },
      },
    })).not.toThrow();

    // Platform artifact writes are no longer allowed
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
        estateType: 'distributed-platform',
        primaryRepoId: 'crud-app',
        selectedRepoIds: ['crud-app'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
      before: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
          '/repos/shared-lib': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': ['AgentWorkSpace/tasks/task-test-001/handoffs/issues.md'],
          '/repos/crud-app': ['src/app.ts'],
          '/repos/shared-lib': [],
        },
      },
    })).toThrow(DaltonConfinementError);
  });

  it('rejects distributed edits in non-primary repos', () => {
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app', '/repos/shared-lib'],
        estateType: 'distributed-platform',
        primaryRepoId: 'crud-app',
        selectedRepoIds: ['crud-app'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
      before: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
          '/repos/shared-lib': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
          '/repos/shared-lib': ['src/leak.ts'],
        },
      },
    })).toThrow(DaltonConfinementError);
  });

  it('rejects monolith edits outside the selected primary focus path', () => {
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/monolith',
        visibleRepoRoots: ['/repos/monolith'],
        declaredRepoRoots: ['/repos/monolith'],
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
          '/platform': [],
          '/repos/monolith': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': [],
          '/repos/monolith': ['apps/web/page.tsx'],
        },
      },
    })).toThrow(DaltonConfinementError);
  });

  it('confines file focus writes to the exact selected file', () => {
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app'],
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
          '/platform': [],
          '/repos/crud-app': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': ['src/handler.tsx'],
        },
      },
    })).toThrow(DaltonConfinementError);
  });

  it('allows writes inside the test target boundary without widening primary writes', () => {
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app'],
        estateType: 'distributed-platform',
        primaryRepoId: 'crud-app',
        primaryFocusRelativePath: 'src/handler.ts',
        primaryFocusTargetKind: 'file',
        testTarget: {
          path: 'tests/unit',
          kind: 'directory',
          resolvedPath: '/repos/crud-app/tests/unit',
        },
        selectedRepoIds: ['crud-app'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
      before: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': ['tests/unit/handler.test.ts'],
        },
      },
    })).not.toThrow();
  });

  it('rejects platform writes to testing skip receipts', () => {
    expect(() => validateDaltonBoundaryChanges({
      platformRepoRoot: '/platform',
      focused: {
        primaryRepoRoot: '/repos/crud-app',
        visibleRepoRoots: ['/repos/crud-app'],
        declaredRepoRoots: ['/repos/crud-app'],
        estateType: 'single-repo',
        primaryRepoId: 'crud-app',
        selectedRepoIds: ['crud-app'],
        selectedFocusIds: [],
        authoritySource: 'active-task-sidecar',
      },
      before: {
        byRepoRoot: {
          '/platform': [],
          '/repos/crud-app': [],
        },
      },
      after: {
        byRepoRoot: {
          '/platform': ['.platform-state/runtime/guardrails/testing-skip.json'],
          '/repos/crud-app': [],
        },
      },
    })).toThrow(DaltonConfinementError);
  });
});
