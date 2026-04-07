import { describe, expect, it } from 'vitest';

import type { ContextPackDiscoverPrefillResponse } from '../../shared/desktopContract';
import type { ContextPackCreationDraft } from '../contextPackCreationTypes';
import { INITIAL_DRAFT, createFocusAreaEntry, createRepositoryEntry } from './useContextPackDraft';
import { buildDraftFromDiscovery } from './useContextPackDiscovery';

function makeDiscoveryResponse(
  overrides: Partial<ContextPackDiscoverPrefillResponse> = {},
): ContextPackDiscoverPrefillResponse {
  return {
    action: 'contextPack.discoverPrefill',
    mode: 'discovered',
    message: 'Discovery complete.',
    rootPath: '/tmp/root',
    discoveryMode: 'auto',
    estateType: 'distributed',
    suggestedContextPackId: 'test-pack',
    suggestedDisplayName: 'Test Pack',
    warnings: [],
    candidateRepos: [
      {
        repoId: 'repo-1',
        repoName: 'Repo One',
        path: '/tmp/root/repo-1',
        relativePath: 'repo-1',
        highSignalPaths: ['src/'],
        repositoryType: 'primary',
      },
    ],
    candidateFocusAreas: [],
    highSignalPaths: [],
    ...overrides,
  };
}

describe('buildDraftFromDiscovery', () => {
  it('populates draft fields from a distributed discovery response', () => {
    const draft: ContextPackCreationDraft = { ...INITIAL_DRAFT };
    const response = makeDiscoveryResponse();
    const result = buildDraftFromDiscovery(draft, response);

    expect(result.discoveryRoot).toBe('/tmp/root');
    expect(result.mode).toBe('distributed');
    expect(result.contextPackId).toBe('test-pack');
    expect(result.estateName).toBe('Test Pack');
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].repoRoot).toBe('/tmp/root/repo-1');
    expect(result.repositories[0].repoName).toBe('Repo One');
    expect(result.repositories[0].primary).toBe(true);
    expect(result.focusAreas).toHaveLength(0);
  });

  it('generates contextPackDir from rootPath when dir is empty', () => {
    const draft: ContextPackCreationDraft = { ...INITIAL_DRAFT, contextPackDir: '' };
    const response = makeDiscoveryResponse();
    const result = buildDraftFromDiscovery(draft, response);
    expect(result.contextPackDir).toBe('/tmp/root/test-pack');
  });

  it('appends contextPackId to existing dir when it does not end with the id', () => {
    const draft: ContextPackCreationDraft = { ...INITIAL_DRAFT, contextPackDir: '/custom/path' };
    const response = makeDiscoveryResponse();
    const result = buildDraftFromDiscovery(draft, response);
    expect(result.contextPackDir).toBe('/custom/path/test-pack');
  });

  it('preserves existing dir when it already ends with the contextPackId', () => {
    const draft: ContextPackCreationDraft = { ...INITIAL_DRAFT, contextPackDir: '/custom/test-pack' };
    const response = makeDiscoveryResponse();
    const result = buildDraftFromDiscovery(draft, response);
    expect(result.contextPackDir).toBe('/custom/test-pack');
  });

  it('populates draft fields from a monolith discovery response', () => {
    const response = makeDiscoveryResponse({
      estateType: 'monolith',
      candidateRepos: [],
      candidateFocusAreas: [
        {
          focusId: 'core',
          focusName: 'Core Module',
          focusType: 'module',
          path: '/tmp/root/src/core',
          relativePath: 'src/core',
          group: 'main',
          repositoryType: 'primary',
        },
      ],
    });
    const draft: ContextPackCreationDraft = { ...INITIAL_DRAFT };
    const result = buildDraftFromDiscovery(draft, response);

    expect(result.mode).toBe('monolith');
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].repoRoot).toBe('/tmp/root');
    expect(result.repositories[0].systemLayer).toBe('shared');
    expect(result.repositories[0].primary).toBe(true);
    expect(result.focusAreas).toHaveLength(1);
    expect(result.focusAreas[0].focusId).toBe('core');
    expect(result.focusAreas[0].focusName).toBe('Core Module');
    expect(result.focusAreas[0].primary).toBe(true);
    expect(result.focusAreas[0].repositoryType).toBe('primary');
  });

  it('maps support repository type for discovered monolith focus areas', () => {
    const response = makeDiscoveryResponse({
      estateType: 'monolith',
      candidateRepos: [],
      candidateFocusAreas: [
        {
          focusId: 'docs',
          focusName: 'Docs',
          focusType: 'docs',
          path: '/tmp/root/docs',
          relativePath: 'docs',
          repositoryType: 'support',
        },
      ],
    });

    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);

    expect(result.focusAreas[0].primary).toBe(true);
    expect(result.focusAreas[0].repositoryType).toBe('primary');
  });

  it('collapses multiple discovered monolith primaries to a single default primary', () => {
    const response = makeDiscoveryResponse({
      estateType: 'monolith',
      candidateRepos: [],
      candidateFocusAreas: [
        {
          focusId: 'api',
          focusName: 'API',
          focusType: 'service',
          path: '/tmp/root/services/api',
          relativePath: 'services/api',
          repositoryType: 'primary',
        },
        {
          focusId: 'web',
          focusName: 'Web',
          focusType: 'application',
          path: '/tmp/root/apps/web',
          relativePath: 'apps/web',
          repositoryType: 'primary',
        },
      ],
    });

    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);

    expect(result.focusAreas.map((focusArea) => focusArea.primary)).toEqual([true, true]);
    expect(result.focusAreas.map((focusArea) => focusArea.repositoryType)).toEqual([
      'primary',
      'primary',
    ]);
  });

  it('maps multiple candidate repos with decreasing priority', () => {
    const response = makeDiscoveryResponse({
      candidateRepos: [
        { repoId: 'a', repoName: 'Alpha', path: '/a', relativePath: 'a', highSignalPaths: [], repositoryType: 'primary' },
        { repoId: 'b', repoName: 'Beta', path: '/b', relativePath: 'b', highSignalPaths: [], repositoryType: 'support' },
        { repoId: 'c', repoName: 'Gamma', path: '/c', relativePath: 'c', highSignalPaths: [], repositoryType: 'support' },
      ],
    });
    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);
    expect(result.repositories).toHaveLength(3);
    expect(result.repositories[0].primary).toBe(true);
    expect(result.repositories[1].primary).toBe(false);
    expect(result.repositories[0].activationPriority).toBe(100);
    expect(result.repositories[1].activationPriority).toBe(90);
    expect(result.repositories[2].activationPriority).toBe(80);
  });

  it('respects repositoryType when discovery marks a non-first repo as primary', () => {
    const response = makeDiscoveryResponse({
      candidateRepos: [
        { repoId: 'a', repoName: 'Alpha', path: '/a', relativePath: 'a', highSignalPaths: [], repositoryType: 'support' },
        { repoId: 'b', repoName: 'Beta', path: '/b', relativePath: 'b', highSignalPaths: [], repositoryType: 'primary' },
      ],
    });

    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);

    expect(result.repositories[0].primary).toBe(false);
    expect(result.repositories[1].primary).toBe(true);
    expect(result.repositories[1].defaultFocusable).toBe(true);
  });

  it('infers frontend systemLayer for web-named repos', () => {
    const response = makeDiscoveryResponse({
      candidateRepos: [
        { repoId: 'web-app', repoName: 'Web App', path: '/web', relativePath: 'web', highSignalPaths: [] },
      ],
    });
    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);
    expect(result.repositories[0].systemLayer).toBe('frontend');
  });

  it('infers infrastructure systemLayer for infra-named repos', () => {
    const response = makeDiscoveryResponse({
      candidateRepos: [
        { repoId: 'infra-core', repoName: 'Infra Core', path: '/infra', relativePath: 'infra', highSignalPaths: [] },
      ],
    });
    const result = buildDraftFromDiscovery({ ...INITIAL_DRAFT }, response);
    expect(result.repositories[0].systemLayer).toBe('infrastructure');
  });

  it('preserves distributed draft entries when discovery finds zero candidate repos', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      repositories: [
        createRepositoryEntry({
          key: 'repo-1',
          repoRoot: '/existing/repo',
          repoName: 'Existing Repo',
          repoId: 'existing-repo',
          systemLayer: 'backend',
          languages: 'typescript',
          artifactRoots: '',
          documentPaths: '',
          boundedContext: '',
          serviceName: '',
          repoRole: '',
          workspaceActivationGroup: '',
          defaultFocusable: true,
          activationPriority: 100,
          primary: true,
          repositoryType: 'primary',
          owner: '',
        }),
      ],
    };

    const response = makeDiscoveryResponse({
      candidateRepos: [],
      suggestedContextPackId: 'empty-estate',
      suggestedDisplayName: 'Empty Estate',
    });

    const result = buildDraftFromDiscovery(draft, response);

    expect(result.repositories).toEqual(draft.repositories);
    expect(result.focusAreas).toEqual(draft.focusAreas);
    expect(result.contextPackId).toBe('empty-estate');
    expect(result.estateName).toBe('Empty Estate');
  });

  it('preserves monolith focus areas when discovery finds zero focus candidates', () => {
    const draft: ContextPackCreationDraft = {
      ...INITIAL_DRAFT,
      mode: 'monolith',
      repositories: [
        createRepositoryEntry({
          key: 'repo-1',
          repoRoot: '/mono',
          repoName: 'Mono',
          repoId: 'mono',
          owner: '',
          systemLayer: 'shared',
          languages: 'python',
          artifactRoots: '',
          documentPaths: '',
          boundedContext: '',
          serviceName: '',
          repoRole: '',
          workspaceActivationGroup: '',
          defaultFocusable: true,
          activationPriority: 100,
          primary: true,
          repositoryType: 'primary',
        }),
      ],
      focusAreas: [
        createFocusAreaEntry({
          key: 'focus-1',
          focusId: 'core',
          focusName: 'Core',
          relativePath: 'src/core',
          path: '/mono/src/core',
          focusType: 'backend',
          group: '',
          defaultFocusable: true,
          activationPriority: 100,
          primary: true,
          repositoryType: 'primary',
        }),
      ],
    };

    const response = makeDiscoveryResponse({
      estateType: 'monolith',
      candidateRepos: [],
      candidateFocusAreas: [],
    });

    const result = buildDraftFromDiscovery(draft, response);

    expect(result.repositories).toEqual(draft.repositories);
    expect(result.focusAreas).toEqual(draft.focusAreas);
    expect(result.mode).toBe('monolith');
  });
});
