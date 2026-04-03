import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useState } from 'react';

import type { ContextPackCreationDraft } from '../contextPackCreationTypes';
import {
  buildValidationErrors,
  createFocusAreaEntry,
  createRepositoryEntry,
  directoryName,
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

  describe('createRepositoryEntry', () => {
    it('creates entry with defaults', () => {
      const entry = createRepositoryEntry();
      expect(entry.systemLayer).toBe('backend');
      expect(entry.primary).toBe(false);
      expect(entry.key).toBeTruthy();
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
    it('ensures a primary repository for distributed mode', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        repositories: [
          createRepositoryEntry({ key: 'r1', primary: false }),
          createRepositoryEntry({ key: 'r2', primary: false }),
        ],
      };
      const normalized = normalizeDraftForMode(draft);
      expect(normalized.repositories[0].primary).toBe(true);
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

    it('collapses multiple monolith primary focus areas to the first typed primary', () => {
      const draft: ContextPackCreationDraft = {
        ...INITIAL_DRAFT,
        mode: 'monolith',
        repositories: [createRepositoryEntry({ key: 'r1', primary: true })],
        focusAreas: [
          createFocusAreaEntry({ key: 'f1', focusName: 'One', repositoryType: 'primary' }),
          createFocusAreaEntry({ key: 'f2', focusName: 'Two', primary: true, repositoryType: 'primary' }),
          createFocusAreaEntry({ key: 'f3', focusName: 'Three', repositoryType: 'support' }),
        ],
      };

      const normalized = normalizeDraftForMode(draft);

      expect(normalized.focusAreas.map((focusArea) => focusArea.repositoryType)).toEqual([
        'primary',
        'support',
        'support',
      ]);
      expect(normalized.focusAreas.map((focusArea) => focusArea.primary)).toEqual([
        true,
        false,
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
    expect(result.current.draft.contextPackId).toMatch(/^orders-estate-\d{4}$/);
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

  it('updateFocusAreaPrimary sets only the target as primary', () => {
    const { result } = renderHook(() => useTestDraft());

    act(() => {
      result.current.setMode('monolith');
    });

    act(() => {
      result.current.addFocusArea();
      result.current.addFocusArea();
    });

    const secondKey = result.current.draft.focusAreas[1].key;

    act(() => {
      result.current.updateFocusAreaPrimary(secondKey);
    });

    expect(result.current.draft.focusAreas[0].primary).toBe(false);
    expect(result.current.draft.focusAreas[1].primary).toBe(true);
    expect(result.current.draft.focusAreas[0].repositoryType).toBe('support');
    expect(result.current.draft.focusAreas[1].repositoryType).toBe('primary');
  });
});
