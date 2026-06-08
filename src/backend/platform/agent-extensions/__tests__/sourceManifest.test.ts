import { describe, it, expect } from 'vitest';
import { parseSourceManifest, serializeSourceManifest } from '../sourceManifest.js';
import type { AgentExtensionSourceManifestEntry, AgentExtensionsSourceManifest } from '../types.js';

const ACTIVE_PROVIDER_ID = 'copilot';

const VALID_GIT_ENTRY = {
  id: 'my-skill',
  kind: 'skill',
  provider_id: ACTIVE_PROVIDER_ID,
  display_name: 'My Skill',
  description: 'A test skill',
  enabled: true,
  source: { type: 'git', url: 'https://example.com/repo.git', ref: 'main' },
};

const VALID_MANIFEST = JSON.stringify({
  schema_version: 1,
  extensions: [VALID_GIT_ENTRY],
});

const EMPTY_MANIFEST = JSON.stringify({ schema_version: 1, extensions: [] });

function parse(raw: string, context = 'test'): AgentExtensionsSourceManifest {
  return parseSourceManifest(raw, context, ACTIVE_PROVIDER_ID);
}

describe('parseSourceManifest', () => {
  it('parses a valid manifest with a git skill entry', () => {
    const result = parse(VALID_MANIFEST);
    expect(result.schema_version).toBe(1);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].id).toBe('my-skill');
    expect(result.extensions[0].kind).toBe('skill');
  });

  it('parses an empty extensions manifest', () => {
    const result = parse(EMPTY_MANIFEST);
    expect(result.extensions).toHaveLength(0);
  });

  it('throws on wrong schema_version', () => {
    const raw = JSON.stringify({ schema_version: 2, extensions: [] });
    expect(() => parse(raw)).toThrow('schema_version must be 1');
  });

  it('throws on invalid JSON', () => {
    expect(() => parse('{ broken')).toThrow();
  });

  it('throws if extensions is not an array', () => {
    const raw = JSON.stringify({ schema_version: 1, extensions: {} });
    expect(() => parse(raw)).toThrow('extensions array');
  });

  it('throws on invalid ID pattern (uppercase)', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, id: 'Invalid-ID' }],
    });
    expect(() => parse(raw)).toThrow('invalid id');
  });

  it('throws on ID that starts with a hyphen', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, id: '-bad' }],
    });
    expect(() => parse(raw)).toThrow('invalid id');
  });

  it('throws on duplicate IDs across skill and plugin', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [
        VALID_GIT_ENTRY,
        {
          id: 'my-skill',
          kind: 'plugin',
          provider_id: ACTIVE_PROVIDER_ID,
          display_name: 'My Plugin',
          description: 'A plugin',
          enabled: true,
          source: { type: 'git', url: 'https://example.com/p.git', ref: 'main' },
        },
      ],
    });
    expect(() => parse(raw)).toThrow('Duplicate extension ID');
  });

  it('throws on plugin with direct-attachment source', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [
        {
          id: 'my-plugin',
          kind: 'plugin',
          provider_id: ACTIVE_PROVIDER_ID,
          display_name: 'My Plugin',
          description: 'A plugin',
          enabled: true,
          source: { type: 'direct-attachment', config_path: 'config/skill-authored/x/SKILL.md' },
        },
      ],
    });
    expect(() => parse(raw)).toThrow('direct-attachment');
  });

  it('accepts a skill with direct-attachment source', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [
        {
          id: 'my-skill',
          kind: 'skill',
          provider_id: ACTIVE_PROVIDER_ID,
          display_name: 'My Skill',
          description: 'A skill',
          enabled: true,
          source: { type: 'direct-attachment', config_path: 'config/skill-authored/my-skill/SKILL.md' },
        },
      ],
    });
    const result = parse(raw);
    expect(result.extensions[0].source.type).toBe('direct-attachment');
  });

  it('throws on missing display_name', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, display_name: '' }],
    });
    expect(() => parse(raw)).toThrow('display_name');
  });

  it('throws on missing description', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, description: '' }],
    });
    expect(() => parse(raw)).toThrow('description');
  });

  it('throws on invalid kind', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, kind: 'widget' }],
    });
    expect(() => parse(raw)).toThrow('kind');
  });

  it('throws on provider_id different from the active provider', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [{ ...VALID_GIT_ENTRY, provider_id: 'openai' }],
    });
    expect(() => parse(raw)).toThrow('provider_id');
  });

  it('accepts local source type', () => {
    const raw = JSON.stringify({
      schema_version: 1,
      extensions: [
        {
          ...VALID_GIT_ENTRY,
          id: 'local-skill',
          source: { type: 'local', path: '/some/path' },
        },
      ],
    });
    const result = parse(raw);
    expect(result.extensions[0].source.type).toBe('local');
  });
});

describe('serializeSourceManifest', () => {
  it('serialization contracts: sorted output, trailing newline, and round-trip', () => {
    const twoEntry: AgentExtensionsSourceManifest = {
      schema_version: 1,
      extensions: [
        { ...VALID_GIT_ENTRY, id: 'z-skill', display_name: 'Z', description: 'Z desc', enabled: true } as AgentExtensionSourceManifestEntry,
        { ...VALID_GIT_ENTRY, id: 'a-skill', display_name: 'A', description: 'A desc', enabled: true } as AgentExtensionSourceManifestEntry,
      ],
    };
    const serialized = serializeSourceManifest(twoEntry);
    const parsed = JSON.parse(serialized) as { extensions: Array<{ id: string }> };
    expect(parsed.extensions[0].id).toBe('a-skill');
    expect(parsed.extensions[1].id).toBe('z-skill');
    expect(serialized).toMatch(/\n$/);

    const oneEntry: AgentExtensionsSourceManifest = {
      schema_version: 1,
      extensions: [
        {
          id: 'my-skill',
          kind: 'skill',
          provider_id: ACTIVE_PROVIDER_ID,
          display_name: 'My Skill',
          description: 'A test skill',
          enabled: true,
          source: { type: 'git', url: 'https://example.com/r.git', ref: 'main' },
        },
      ],
    };
    expect(parse(serializeSourceManifest(oneEntry), 'round-trip')).toEqual(oneEntry);
  });
});
