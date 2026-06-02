import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';

import type { ContextPackCreationDraft } from '../contextPackCreationTypes';
import {
  buildDraftFromWizardParts,
  buildValidationErrors,
  createFocusAreaEntry,
  createRepositoryEntry,
  directoryName,
  ensureUniqueId,
  generateContextPackId,
  INITIAL_DRAFT,
  normalizeDraftForMode,
  parseCsv,
  slugifyValue,
  titleizeValue,
  useContextPackDraft,
} from './useContextPackDraft';

afterEach(() => {
  cleanup();
});

function useTestDraft() {
  const [draft, setDraft] = useState<ContextPackCreationDraft>({ ...INITIAL_DRAFT });
  const handlers = useContextPackDraft((updater) => setDraft((prev) => updater(prev)));
  return { draft, ...handlers };
}

describe('pure helpers', () => {
  describe('slugifyValue', () => {
    it('converts display name to slug', () => {
      expect(slugifyValue('Orders Estate')).toBe('orders-estate');
    });

    it('returns "context-pack" for empty string', () => {
      expect(slugifyValue('  ')).toBe('context-pack');
    });

    it('strips leading and trailing hyphens', () => {
      expect(slugifyValue('--hello--')).toBe('hello');
    });

    it('byte-identity: My Pack 2026! -> my-pack-2026', () => {
      // Proves the renderer and main-process slugify functions are identical
      // (both re-exported from src/shared/slug.ts).
      expect(slugifyValue('My Pack 2026!')).toBe('my-pack-2026');
    });
  });

  describe('titleizeValue', () => {
    it('capitalizes words separated by hyphens', () => {
      expect(titleizeValue('orders-estate')).toBe('Orders Estate');
    });

    it('returns "Context Pack" for empty input', () => {
      expect(titleizeValue('')).toBe('Context Pack');
    });
  });

  describe('directoryName', () => {
    it('extracts last path segment', () => {
      expect(directoryName('/tmp/packs/orders-estate')).toBe('orders-estate');
    });

    it('extracts the last segment from Windows-native paths', () => {
      expect(directoryName('C:\\packs\\orders-estate')).toBe('orders-estate');
    });

    it('returns "context-pack" for root path', () => {
      expect(directoryName('/')).toBe('context-pack');
    });
  });

  describe('parseCsv', () => {
    it('splits comma-separated values', () => {
      expect(parseCsv('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('filters empty entries', () => {
      expect(parseCsv('a,, ,b')).toEqual(['a', 'b']);
    });
  });

  describe('generateContextPackId', () => {
    it('returns a stable four-digit suffix for the same display name', () => {
      expect(generateContextPackId('Orders Estate')).toBe(generateContextPackId('Orders Estate'));
      expect(generateContextPackId('Orders Estate')).toMatch(/^orders-estate-\d{4}$/);
    });
  });

  describe('ensureUniqueId', () => {
    it('deduplicates repeated ids with numeric suffixes', () => {
      const seen = new Set<string>();

      expect(ensureUniqueId('orders-api', seen)).toBe('orders-api');
      expect(ensureUniqueId('orders-api', seen)).toBe('orders-api-2');
      expect(ensureUniqueId('orders-api', seen)).toBe('orders-api-3');
    });
  });

  describe('createRepositoryEntry', () => {
    it('creates entry with defaults', () => {
      const entry = createRepositoryEntry();
      expect(entry.systemLayer).toBe('backend');
      expect(entry.primary).toBe(false);
      expect(entry.key).toBeTruthy();
      expect(entry.repoCategory).toBe('unknown');
      expect(entry.repoCategoryAuthored).toBe(false);
      expect(entry.repoCategoryConfidence).toBeUndefined();
    });

    it('applies seed overrides', () => {
      const entry = createRepositoryEntry({ repoName: 'Test', primary: true });
      expect(entry.repoName).toBe('Test');
      expect(entry.primary).toBe(true);
    });
  });

  describe('createFocusAreaEntry', () => {
    it('creates entry with defaults', () => {
      const entry = createFocusAreaEntry();
      expect(entry.focusType).toBe('general');
      expect(entry.primary).toBe(false);
      expect(entry.repositoryType).toBe('support');
    });
  });

  describe('normalizeDraftForMode', () => {
    it('preserves missing primary repository state for distributed gating', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        repositories: [
          createRepositoryEntry({ key: 'r1', primary: false }),
          createRepositoryEntry({ key: 'r2', primary: false }),
        ],
      };
      const normalized = normalizeDraftForMode(draft);
      expect(normalized.repositories[0].primary).toBe(false);
      expect(normalized.repositories[1].primary).toBe(false);
    });

    it('ensures a primary focus area for monolith mode', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        mode: 'monolith',
        repositories: [createRepositoryEntry({ key: 'r1', primary: true })],
        focusAreas: [
          createFocusAreaEntry({ key: 'f1', primary: false }),
        ],
      };
      const normalized = normalizeDraftForMode(draft);
      expect(normalized.focusAreas[0].primary).toBe(true);
      expect(normalized.focusAreas[0].repositoryType).toBe('primary');
    });

    it('preserves multiple monolith primary focus areas without collapsing', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        mode: 'monolith',
        repositories: [createRepositoryEntry({ key: 'r1', primary: true })],
        focusAreas: [
          createFocusAreaEntry({ key: 'f1', focusName: 'One', primary: true, repositoryType: 'primary' }),
          createFocusAreaEntry({ key: 'f2', focusName: 'Two', primary: true, repositoryType: 'primary' }),
          createFocusAreaEntry({ key: 'f3', focusName: 'Three', repositoryType: 'support' }),
        ],
      };

      const normalized = normalizeDraftForMode(draft);

      expect(normalized.focusAreas.map((focusArea) => focusArea.repositoryType)).toEqual([
        'primary',
        'primary',
        'support',
      ]);
      expect(normalized.focusAreas.map((focusArea) => focusArea.primary)).toEqual([
        true,
        true,
        false,
      ]);
    });
  });

  describe('buildValidationErrors', () => {
    it('reports all missing required fields on empty draft', () => {
      const errors = buildValidationErrors(INITIAL_DRAFT);
      expect(errors).toContainEqual('Choose a context-pack destination before creating the pack.');
      expect(errors).toContainEqual('Choose a discovery root before continuing.');
      expect(errors).toContainEqual('Context-pack ID is required.');
      expect(errors).toContainEqual('Display name is required.');
      expect(errors).toContainEqual('Add at least one repository to the estate definition.');
    });

    it('reports monolith focus area requirement', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        mode: 'monolith',
        contextPackDir: '/tmp/pack',
        discoveryRoot: '/tmp/root',
        contextPackId: 'id',
        estateName: 'name',
        repositories: [createRepositoryEntry({ repoRoot: '/repo', repoName: 'Repo' })],
      };
      const errors = buildValidationErrors(draft);
      expect(errors).toContainEqual('Monolith creation requires at least one focus area.');
    });

    it('uses the new-project location validation copy for wizard drafts', () => {
      const errors = buildValidationErrors({
        ...INITIAL_DRAFT,
        creationOrigin: 'new',
      });

      expect(errors).toContain('Choose a project location before continuing.');
      expect(errors).not.toContain('Choose a discovery root before continuing.');
    });

    it('returns no errors for a valid distributed draft', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        contextPackDir: '/tmp/pack',
        discoveryRoot: '/tmp/root',
        contextPackId: 'id',
        estateName: 'name',
        repositories: [createRepositoryEntry({ repoRoot: '/repo', repoName: 'Repo', primary: true })],
      };
      expect(buildValidationErrors(draft)).toEqual([]);
    });
  });

  describe('buildDraftFromWizardParts', () => {
    it('materializes distributed wizard parts into unique repositories', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        creationOrigin: 'new',
        mode: 'distributed',
        discoveryRoot: '/workspace',
      };

      const result = buildDraftFromWizardParts(draft, [
        {
          key: 'p1',
          name: 'Orders API',
          role: 'backend',
          language: 'python',
          languageIsOther: false,
          location: '/workspace/orders-api',
          primary: true,
          editing: false,
        },
        {
          key: 'p2',
          name: 'orders-api',
          role: 'frontend',
          language: 'typescript',
          languageIsOther: false,
          location: '/workspace/orders-web',
          primary: false,
          editing: false,
        },
      ]);

      expect(result.repositories.map((repository) => repository.repoId)).toEqual([
        'orders-api',
        'orders-api-2',
      ]);
      expect(result.repositories.map((repository) => repository.languages)).toEqual([
        'python',
        'typescript',
      ]);
      expect(result.focusAreas).toEqual([]);
    });

    it('materializes monolith wizard parts into unique focus areas', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        creationOrigin: 'new',
        mode: 'monolith',
        discoveryRoot: '/workspace/mono',
      };

      const result = buildDraftFromWizardParts(draft, [
        {
          key: 'p1',
          name: 'Core API',
          role: 'backend',
          language: 'python',
          languageIsOther: false,
          location: 'src/core',
          primary: true,
          editing: false,
        },
        {
          key: 'p2',
          name: 'core-api',
          role: 'documents',
          language: 'markdown',
          languageIsOther: false,
          location: 'docs',
          primary: false,
          editing: false,
        },
      ]);

      expect(result.repositories).toHaveLength(1);
      expect(result.repositories[0].repoRoot).toBe('/workspace/mono');
      expect(result.repositories[0].languages).toBe('python, markdown');
      expect(result.focusAreas.map((focusArea) => focusArea.focusId)).toEqual([
        'core-api',
        'core-api-2',
      ]);
      expect(result.focusAreas[0].focusType).toBe('backend');
      expect(result.focusAreas[1].focusType).toBe('docs');
      expect(result.focusAreas[0].path).toBe('/workspace/mono/src/core');
    });

    it('promotes infrastructure parts to sibling repository entries in monolith mode', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        creationOrigin: 'new',
        mode: 'monolith-platform',
        discoveryRoot: '/workspace/mono',
      };

      const result = buildDraftFromWizardParts(draft, [
        {
          key: 'p1',
          name: 'Core API',
          role: 'backend',
          language: 'python',
          languageIsOther: false,
          location: 'src/core',
          primary: true,
          editing: false,
        },
        {
          key: 'p2',
          name: 'Deploy',
          role: 'infrastructure',
          language: 'yaml',
          languageIsOther: false,
          location: '/workspace/deploy',
          primary: false,
          editing: false,
        },
      ]);

      expect(result.repositories).toHaveLength(2);
      expect(result.repositories[0].repoRoot).toBe('/workspace/mono');
      expect(result.repositories[1].repoRoot).toBe('/workspace/deploy');
      expect(result.repositories[1].systemLayer).toBe('infrastructure');
      expect(result.focusAreas).toHaveLength(1);
      expect(result.focusAreas[0].focusName).toBe('Core API');
    });
  });
});

describe('useContextPackDraft hook', () => {
  it('starts with INITIAL_DRAFT state', () => {
    const { result } = renderHook(() => useTestDraft());
    expect(result.current.draft).toEqual(INITIAL_DRAFT);
  });

  it('setDraftField updates a single field', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setDraftField('discoveryRoot', '/tmp/root');
    });

    expect(result.current.draft.discoveryRoot).toBe('/tmp/root');
  });

  it('setDraftField for estateName also generates contextPackId', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setDraftField('estateName', 'Orders Estate');
    });

    expect(result.current.draft.estateName).toBe('Orders Estate');
    expect(result.current.draft.contextPackId).toBe(generateContextPackId('Orders Estate'));
  });

  it('setMode switches to monolith and clears focus areas on switch to distributed', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    expect(result.current.draft.mode).toBe('monolith');
    expect(result.current.draft.repositories).toHaveLength(1);
    expect(result.current.draft.repositories[0].systemLayer).toBe('shared');

    act(() => {
      result.current.addFocusArea();
    });

    expect(result.current.draft.focusAreas).toHaveLength(1);

    act(() => {
      result.current.setMode('distributed');
    });

    expect(result.current.draft.mode).toBe('distributed');
    expect(result.current.draft.focusAreas).toHaveLength(0);
  });

  it('addRepository appends a new entry', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.addRepository();
    });

    expect(result.current.draft.repositories).toHaveLength(1);
    expect(result.current.draft.repositories[0].systemLayer).toBe('backend');
  });

  it('removeRepository removes by key', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.addRepository();
      result.current.addRepository();
    });

    const keyToRemove = result.current.draft.repositories[0].key;

    act(() => {
      result.current.removeRepository(keyToRemove);
    });

    expect(result.current.draft.repositories).toHaveLength(1);
    expect(result.current.draft.repositories[0].key).not.toBe(keyToRemove);
  });

  it('updateRepository updates a specific field on the matching entry', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.addRepository();
    });

    const key = result.current.draft.repositories[0].key;

    act(() => {
      result.current.updateRepository(key, 'repoName', 'Orders API');
    });

    expect(result.current.draft.repositories[0].repoName).toBe('Orders API');
  });

  it('updateRepositoryPrimary toggles primary independently per repo', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.addRepository();
      result.current.addRepository();
    });

    const firstKey = result.current.draft.repositories[0].key;
    const secondKey = result.current.draft.repositories[1].key;

    // Mark first as primary.
    act(() => {
      result.current.updateRepositoryPrimary(firstKey);
    });
    expect(result.current.draft.repositories[0].primary).toBe(true);
    expect(result.current.draft.repositories[1].primary).toBe(false);

    // Toggle second independently — first stays primary.
    act(() => {
      result.current.updateRepositoryPrimary(secondKey);
    });
    expect(result.current.draft.repositories[0].primary).toBe(true);
    expect(result.current.draft.repositories[1].primary).toBe(true);
    expect(result.current.draft.repositories[1].repositoryType).toBe('primary');
    expect(result.current.draft.repositories[1].defaultFocusable).toBe(true);

    // Toggle second off — first still primary.
    act(() => {
      result.current.updateRepositoryPrimary(secondKey);
    });
    expect(result.current.draft.repositories[0].primary).toBe(true);
    expect(result.current.draft.repositories[1].primary).toBe(false);
    expect(result.current.draft.repositories[1].repositoryType).toBe('support');
  });

  it('keeps library category when operator marks the repo primary', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.updateDraft((draft) => ({
        ...draft,
        repositories: [
          createRepositoryEntry({
            key: 'repo-1',
            repoName: 'Shared Library',
            repoCategory: 'library',
            primary: false,
            repositoryType: 'support',
          }),
        ],
      }));
    });

    act(() => {
      result.current.updateRepositoryPrimary('repo-1');
    });

    expect(result.current.draft.repositories[0].primary).toBe(true);
    expect(result.current.draft.repositories[0].repositoryType).toBe('primary');
    expect(result.current.draft.repositories[0].repoCategory).toBe('library');
    expect(result.current.draft.repositories[0].repoCategoryAuthored).toBe(false);
  });

  it('keeps service category when operator marks the repo support', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.updateDraft((draft) => ({
        ...draft,
        repositories: [
          createRepositoryEntry({
            key: 'repo-1',
            repoName: 'Orders API',
            repoCategory: 'service',
            primary: true,
            repositoryType: 'primary',
          }),
        ],
      }));
    });

    act(() => {
      result.current.updateRepositoryPrimary('repo-1');
    });

    expect(result.current.draft.repositories[0].primary).toBe(false);
    expect(result.current.draft.repositories[0].repositoryType).toBe('support');
    expect(result.current.draft.repositories[0].repoCategory).toBe('service');
    expect(result.current.draft.repositories[0].repoCategoryAuthored).toBe(false);
  });

  it('marks repo category authored only when the operator changes category', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.addRepository();
    });

    const key = result.current.draft.repositories[0].key;

    act(() => {
      result.current.updateRepository(key, 'repoCategory', 'tool');
    });

    expect(result.current.draft.repositories[0].repoCategory).toBe('tool');
    expect(result.current.draft.repositories[0].repoCategoryAuthored).toBe(true);
  });

  it('addFocusArea appends a new focus area entry', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    act(() => {
      result.current.addFocusArea();
    });

    expect(result.current.draft.focusAreas).toHaveLength(1);
  });

  it('removeFocusArea removes by key', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    act(() => {
      result.current.addFocusArea();
      result.current.addFocusArea();
    });

    const keyToRemove = result.current.draft.focusAreas[0].key;

    act(() => {
      result.current.removeFocusArea(keyToRemove);
    });

    expect(result.current.draft.focusAreas).toHaveLength(1);
  });

  it('updateFocusArea updates a specific field', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    act(() => {
      result.current.addFocusArea();
    });

    const key = result.current.draft.focusAreas[0].key;

    act(() => {
      result.current.updateFocusArea(key, 'focusName', 'Core Module');
    });

    expect(result.current.draft.focusAreas[0].focusName).toBe('Core Module');
  });

  it('updateFocusAreaPrimary toggles primary independently per focus area', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    act(() => {
      result.current.addFocusArea();
      result.current.addFocusArea();
    });

    // ensurePrimaryFocusArea marks the first as primary on creation
    expect(result.current.draft.focusAreas[0].primary).toBe(true);
    expect(result.current.draft.focusAreas[1].primary).toBe(false);

    const secondKey = result.current.draft.focusAreas[1].key;

    act(() => {
      result.current.updateFocusAreaPrimary(secondKey);
    });

    // Both are now primary — independent toggling allows multiple
    expect(result.current.draft.focusAreas[0].primary).toBe(true);
    expect(result.current.draft.focusAreas[1].primary).toBe(true);
    expect(result.current.draft.focusAreas[0].repositoryType).toBe('primary');
    expect(result.current.draft.focusAreas[1].repositoryType).toBe('primary');

    // Toggle the second back off
    act(() => {
      result.current.updateFocusAreaPrimary(secondKey);
    });

    expect(result.current.draft.focusAreas[1].primary).toBe(false);
    expect(result.current.draft.focusAreas[1].repositoryType).toBe('support');
  });
});
