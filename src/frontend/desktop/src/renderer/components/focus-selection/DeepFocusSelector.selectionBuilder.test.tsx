// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
import DeepFocusSelector from './DeepFocusSelector';

expect.extend(matchers);

afterEach(cleanup);

function makePack(): ContextPackCatalogEntry {
  return {
    contextPackId: 'pack-1',
    displayName: 'Pack',
    contextPackDir: '/packs/pack-1',
    manifestPath: null,
    bootstrapReady: true,
    source: 'configured-path',
    isActive: true,
    estateType: 'distributed-platform',
    defaultScopeMode: null,
    repoCount: 1,
    primaryWorkingRepoIds: [],
    focusTargets: [{
      focusId: 'repo-a',
      displayName: 'Repo A',
      kind: 'repository',
      repoId: 'repo-a',
      repoLocalPath: '/repos/repo-a',
      serviceName: null,
      systemLayer: null,
      repoRole: null,
      repositoryType: null,
      relativePath: null,
      focusType: null,
      group: null,
      defaultFocusable: true,
      activationPriority: 0,
      adjacentRepoIds: [],
      adjacentFocusIds: [],
    }],
  };
}

describe('DeepFocusSelector selection builder inheritance', () => {
  it('renders the Selection Builder in edit mode through SidebarDeepFocusControls', async () => {
    render(
      <DeepFocusSelector
        selectedPack={makePack()}
        selectedWorkingFocusIds={['repo-a']}
        deepFocusEnabled
        deepFocusPrimaryRepoId="repo-a"
        deepFocusPrimaryFocusId={null}
        selectedFocusPath="src/app"
        selectedFocusTargetKind="directory"
        selectedFocusTargets={[{
          path: 'src/app',
          kind: 'directory',
          role: 'anchor',
          repoId: 'repo-a',
          repoLocalPath: '/repos/repo-a',
          supportTargets: [{ path: 'src/app/fixtures', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }],
        }]}
        selectedTestTarget={{ path: 'tests', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }}
        selectedSupportTargets={[{ path: 'docs', kind: 'directory', repoId: 'repo-a', repoLocalPath: '/repos/repo-a' }]}
        onCommitDeepFocusSelection={vi.fn()}
        onListRepoTree={vi.fn().mockResolvedValue({ entries: [], truncated: false })}
        editorOpen
      />,
    );

    expect(await screen.findByLabelText('Deep Focus Selection Builder')).toBeInTheDocument();
    expect(screen.getByText('Selection Builder')).toBeInTheDocument();
    expect(screen.getByText('All primaries')).toBeInTheDocument();
  });
});
