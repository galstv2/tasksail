import { describe, it, expect } from 'vitest';
import { getEnabledComposeServices } from '../composeMetadata.js';
import type { McpRegistry, McpServiceEntry, McpComposeMetadata } from '../types.js';

function makeCompose(overrides?: Partial<McpComposeMetadata>): McpComposeMetadata {
  return {
    serviceName: 'test-svc',
    containerName: 'test-svc',
    image: 'test:local',
    dockerfile: 'docker/test/Dockerfile',
    buildContext: '.',
    hostBind: '127.0.0.1',
    hostPort: 9000,
    containerPort: 9000,
    envFileRefs: ['.env'],
    environment: {},
    volumes: [],
    memoryLimit: '256M',
    cpuLimit: '0.5',
    stopGracePeriod: '10s',
    ...overrides,
  };
}

function makeService(overrides: Partial<McpServiceEntry> & { id: string }): McpServiceEntry {
  return {
    displayName: overrides.id,
    kind: 'container-http',
    enabled: true,
    builtin: true,
    compose: makeCompose({ serviceName: overrides.id }),
    health: { url: 'http://localhost:9000/health', maxRetries: 5, retryIntervalMs: 1000 },
    ...overrides,
  };
}

describe('getEnabledComposeServices', () => {
  it('returns compose metadata for enabled services', () => {
    const registry: McpRegistry = {
      schema_version: 1,
      services: [
        makeService({ id: 'repo-context-mcp', compose: makeCompose({ serviceName: 'repo-context-mcp', hostPort: 8811 }) }),
      ],
    };

    const result = getEnabledComposeServices(registry);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('repo-context-mcp');
    expect(result[0].compose.serviceName).toBe('repo-context-mcp');
    expect(result[0].compose.hostPort).toBe(8811);
  });

  it('excludes disabled services', () => {
    const registry: McpRegistry = {
      schema_version: 1,
      services: [
        makeService({ id: 'enabled-svc', enabled: true }),
        makeService({ id: 'disabled-svc', enabled: false }),
      ],
    };

    const result = getEnabledComposeServices(registry);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('enabled-svc');
  });

  it.each([
    [{ schema_version: 1, services: [makeService({ id: 'disabled', enabled: false })] } as McpRegistry, 'all disabled'],
    [{ schema_version: 1, services: [] } as McpRegistry, 'empty list'],
  ])('returns empty array: %s', (registry, _label) => {
    expect(getEnabledComposeServices(registry)).toEqual([]);
  });

  it('preserves full compose metadata for each service', () => {
    const compose = makeCompose({
      serviceName: 'svc-a',
      image: 'custom:v2',
      hostPort: 7777,
      containerPort: 8888,
      memoryLimit: '1G',
    });
    const registry: McpRegistry = {
      schema_version: 1,
      services: [makeService({ id: 'svc-a', compose })],
    };

    const result = getEnabledComposeServices(registry);
    expect(result[0].compose.image).toBe('custom:v2');
    expect(result[0].compose.hostPort).toBe(7777);
    expect(result[0].compose.containerPort).toBe(8888);
    expect(result[0].compose.memoryLimit).toBe('1G');
  });
});
