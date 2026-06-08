import { describe, it, expect } from 'vitest';
import { toServiceHealthSpecs } from '../healthSpecs.js';
import type { McpRegistry, McpServiceEntry } from '../types.js';

function makeService(overrides: Partial<McpServiceEntry> & { id: string }): McpServiceEntry {
  return {
    displayName: overrides.id,
    kind: 'container-http',
    enabled: true,
    builtin: true,
    compose: {} as never,
    health: {
      url: `http://localhost:9000/health`,
      maxRetries: 5,
      retryIntervalMs: 1000,
    },
    ...overrides,
  };
}

describe('toServiceHealthSpecs', () => {
  it('maps enabled services to ServiceHealthSpec[]', () => {
    const registry: McpRegistry = {
      schema_version: 1,
      services: [
        makeService({
          id: 'repo-context-mcp',
          health: { url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
        }),
      ],
    };

    const specs = toServiceHealthSpecs(registry);
    expect(specs).toEqual([
      {
        name: 'repo-context-mcp',
        url: 'http://localhost:8811/health',
        maxRetries: 10,
        retryIntervalMs: 2000,
      },
    ]);
  });

  it('excludes disabled services', () => {
    const registry: McpRegistry = {
      schema_version: 1,
      services: [
        makeService({ id: 'enabled-svc', enabled: true }),
        makeService({ id: 'disabled-svc', enabled: false }),
      ],
    };

    const specs = toServiceHealthSpecs(registry);
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe('enabled-svc');
  });

  it.each([
    [{ schema_version: 1, services: [makeService({ id: 'disabled-svc', enabled: false })] } as McpRegistry, 'all disabled'],
    [{ schema_version: 1, services: [] } as McpRegistry, 'empty list'],
  ])('returns empty array: %s', (registry, _label) => {
    expect(toServiceHealthSpecs(registry)).toEqual([]);
  });

  it('maps multiple enabled services preserving order', () => {
    const registry: McpRegistry = {
      schema_version: 1,
      services: [
        makeService({
          id: 'svc-a',
          health: { url: 'http://localhost:8811/health', maxRetries: 10, retryIntervalMs: 2000 },
        }),
        makeService({
          id: 'svc-b',
          health: { url: 'http://localhost:9999/health', maxRetries: 3, retryIntervalMs: 500 },
        }),
      ],
    };

    const specs = toServiceHealthSpecs(registry);
    expect(specs).toHaveLength(2);
    expect(specs[0].name).toBe('svc-a');
    expect(specs[1].name).toBe('svc-b');
    expect(specs[1].maxRetries).toBe(3);
  });
});
