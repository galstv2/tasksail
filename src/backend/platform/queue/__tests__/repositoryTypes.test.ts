import { describe, expect, it } from 'vitest';
import {
  deriveStandardSelectionRoles,
  normalizeRepositoryTypesForSelection,
  parseRepositoryTypesJson,
  stableStringifyRepositoryTypes,
} from '../repositoryTypes.js';

describe('repositoryTypes helpers', () => {
  it('normalizes only selected ids and preserves explicit roles', () => {
    expect(normalizeRepositoryTypesForSelection(
      { platform: 'primary', tools: 'support', ignored: 'primary' },
      ['platform', 'tools'],
    )).toEqual({ platform: 'primary', tools: 'support' });
  });

  it('rejects malformed json and invalid roles', () => {
    expect(parseRepositoryTypesJson('[]')).toBeNull();
    expect(parseRepositoryTypesJson('{"platform":"writer"}')).toBeNull();
    expect(parseRepositoryTypesJson('{"":"primary"}')).toBeNull();
  });

  it('stable stringifies sorted keys', () => {
    expect(stableStringifyRepositoryTypes({ tools: 'primary', platform: 'support' }))
      .toBe('{"platform":"support","tools":"primary"}');
  });

  it('derives legacy fallback only from scalar primary when a selected id is missing a role', () => {
    expect(deriveStandardSelectionRoles({
      selectedIds: ['platform', 'tools', 'docs'],
      repositoryTypes: { tools: 'primary' },
      scalarPrimaryId: 'platform',
    })).toEqual({
      primaryIds: ['platform', 'tools'],
      supportIds: ['docs'],
    });
  });
});
