import { describe, expect, it } from 'vitest';

import {
  appendMcpContextBlock,
  buildMcpContextBlock,
  buildMcpContextBlockFromServers,
} from '../pipeline/mcpPromptContext.js';
import type { ExternalMcpRegistry, ExternalMcpServer } from '../../external-mcp-registry/index.js';

function createServer(overrides: Partial<ExternalMcpServer> = {}): ExternalMcpServer {
  return {
    id: 'server-1',
    display_name: 'Planner Guide',
    purpose: 'planning multi-step implementation work',
    enabled: true,
    transport: 'http',
    url: 'http://localhost:8080/mcp',
    agent_scope: {
      mode: 'allowlist',
      agent_ids: ['software-engineer'],
    },
    ...overrides,
  };
}

function createRegistry(servers: ExternalMcpServer[]): ExternalMcpRegistry {
  return {
    schema_version: 1,
    external_servers: servers,
  };
}

describe('buildMcpContextBlock', () => {
  it('returns undefined when the registry is unavailable', () => {
    expect(buildMcpContextBlock(undefined, 'software-engineer')).toBeUndefined();
  });

  it('returns undefined when no enabled agent-scoped servers are present', () => {
    const registry = createRegistry([
      createServer({
        id: 'qa-only',
        agent_scope: { mode: 'allowlist', agent_ids: ['qa'] },
      }),
      createServer({
        id: 'disabled',
        enabled: false,
      }),
    ]);

    expect(buildMcpContextBlock(registry, 'software-engineer')).toBeUndefined();
  });

  it('renders prompt-safe instructional guidance from server metadata', () => {
    const registry = createRegistry([
      createServer({
        display_name: 'Planner\n`Guide`',
        purpose: 'planning\nmulti-step work',
        preferred_for: ['triage linked tasks', 'finding `dependencies`'],
        fallback_description: 'continue with your normal repo investigation flow',
      }),
      createServer({
        id: 'notes',
        display_name: 'Release Notes',
        purpose: 'checking rollout notes',
        preferred_for: ['release verification'],
        fallback_description: 'use standard repository docs and local context instead',
      }),
    ]);

    const block = buildMcpContextBlock(registry, 'software-engineer');

    expect(block).toContain('## External MCP Guidance');
    expect(block).toContain(
      'The following external MCP servers are available for this role. Consider them when their descriptions fit the task, and continue with your other tools when they do not.',
    );
    expect(block).toContain('- "Planner \'Guide\'" may help with planning multi-step work');
    expect(block).toContain(
      'Consider it when the task involves "triage linked tasks", "finding \'dependencies\'".',
    );
    expect(block).toContain(
      'If it is not the best fit, continue with your normal repo investigation flow.',
    );
    expect(block).toContain('- "Release Notes" may help with checking rollout notes');
    expect(block).not.toContain('\n`Guide`');
  });
});

describe('buildMcpContextBlockFromServers', () => {
  it('returns undefined for an empty server list', () => {
    expect(buildMcpContextBlockFromServers([])).toBeUndefined();
  });

  it('ignores disabled servers when building the block', () => {
    const block = buildMcpContextBlockFromServers([
      createServer({ id: 'enabled', display_name: 'Enabled Server' }),
      createServer({ id: 'disabled', display_name: 'Disabled Server', enabled: false }),
    ]);

    expect(block).toContain('"Enabled Server"');
    expect(block).not.toContain('"Disabled Server"');
  });
});

describe('appendMcpContextBlock', () => {
  it('appends the built block and a separator line', () => {
    const parts = ['Intro'];
    const registry = createRegistry([createServer()]);

    appendMcpContextBlock(parts, registry, 'software-engineer', {
      heading: '## MCP Tools',
      introLine: 'Use these when helpful.',
    });

    expect(parts).toEqual([
      'Intro',
      expect.stringContaining('## MCP Tools'),
      '',
    ]);
    expect(parts[1]).toContain('Use these when helpful.');
  });

  it('is a no-op when no scoped servers are available', () => {
    const parts = ['Intro'];
    const registry = createRegistry([
      createServer({
        agent_scope: { mode: 'allowlist', agent_ids: ['qa'] },
      }),
    ]);

    appendMcpContextBlock(parts, registry, 'software-engineer');

    expect(parts).toEqual(['Intro']);
  });
});
