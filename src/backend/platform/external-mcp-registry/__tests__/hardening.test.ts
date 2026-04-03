/**
 * Hardening tests for the external MCP registry.
 *
 * Validates boundary conditions, error quality, and round-trip
 * behaviors for the external MCP registry lifecycle.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  validateExternalMcpRegistry,
  loadExternalMcpRegistry,
  getExternalServersForAgent,
  FILE_NOT_FOUND_FIELD,
} from '../load.js';
import {
  CURRENT_SCHEMA_VERSION,
  ALLOWED_TRANSPORTS,
  MAX_PURPOSE_LENGTH,
  MAX_PREFERRED_FOR_ITEM_LENGTH,
  MAX_PREFERRED_FOR_ITEMS,
  MAX_FALLBACK_DESCRIPTION_LENGTH,
} from '../types.js';
import type { ExternalMcpRegistry, ExternalMcpServer } from '../types.js';

const REAL_DEFAULT = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', '..', '..', 'config', 'mcp-registry-external.default.json'),
  'utf-8',
);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-mcp-harden-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Default registry alignment
// ---------------------------------------------------------------------------

describe('default registry alignment', () => {
  it('default external registry parses with empty external_servers', () => {
    const data = JSON.parse(REAL_DEFAULT) as ExternalMcpRegistry;
    expect(data.schema_version).toBe(CURRENT_SCHEMA_VERSION);
    expect(data.external_servers).toEqual([]);
  });

  it('default external registry validates successfully', () => {
    const result = validateExternalMcpRegistry(JSON.parse(REAL_DEFAULT));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Valid server parsing
// ---------------------------------------------------------------------------

describe('valid server parsing', () => {
  it('accepts a valid server entry with all fields', () => {
    const result = validateExternalMcpRegistry(validRegistryWithServer());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.external_servers).toHaveLength(1);
    expect(result.registry.external_servers[0].id).toBe('vendor-docs');
    expect(result.registry.external_servers[0].purpose).toBe('Vendor API docs');
    expect(result.registry.external_servers[0].preferred_for).toEqual(['auth headers']);
    expect(result.registry.external_servers[0].fallback_description).toBe('Provides search_docs tool');
  });

  it('accepts a valid server without optional fields', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['preferred_for'];
    delete (data.external_servers[0] as Record<string, unknown>)['fallback_description'];
    delete (data.external_servers[0] as Record<string, unknown>)['headers'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.external_servers[0].preferred_for).toBeUndefined();
    expect(result.registry.external_servers[0].fallback_description).toBeUndefined();
    expect(result.registry.external_servers[0].headers).toBeUndefined();
  });

  it('accepts absent external_servers (defaults to empty)', () => {
    const result = validateExternalMcpRegistry({ schema_version: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registry.external_servers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Duplicate server IDs
// ---------------------------------------------------------------------------

describe('duplicate server IDs', () => {
  it('rejects duplicate server IDs', () => {
    const data = validRegistryWithServer();
    data.external_servers.push({ ...data.external_servers[0] });
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('Duplicate'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transport validation
// ---------------------------------------------------------------------------

describe('transport validation', () => {
  for (const transport of ALLOWED_TRANSPORTS) {
    it(`accepts "${transport}" transport`, () => {
      const data = validRegistryWithServer();
      (data.external_servers[0] as Record<string, unknown>).transport = transport;
      const result = validateExternalMcpRegistry(data);
      expect(result.ok).toBe(true);
    });
  }

  for (const bad of ['stdio', 'websocket', 'grpc', '']) {
    it(`rejects "${bad}" transport`, () => {
      const data = validRegistryWithServer();
      (data.external_servers[0] as Record<string, unknown>).transport = bad || undefined;
      const result = validateExternalMcpRegistry(data);
      expect(result.ok).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

describe('URL validation', () => {
  it('accepts https:// URL', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'https://mcp.example.com/sse';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('accepts http://localhost (local dev)', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'http://localhost:8080/mcp';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('accepts http://127.0.0.1 (local dev)', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'http://127.0.0.1:9090/sse';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('accepts http://[::1] (local dev)', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'http://[::1]:9090/sse';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('rejects http:// with remote host', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'http://mcp.remote.example.com/sse';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('local development'))).toBe(true);
  });

  it('rejects non-absolute URL', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = '/relative/path';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.includes('url'))).toBe(true);
  });

  it('rejects ftp:// URL', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = 'ftp://files.example.com/data';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects empty URL', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).url = '';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Header variable reference validation
// ---------------------------------------------------------------------------

describe('header variable reference validation', () => {
  const cases: { input: string; shouldFail: boolean; label: string }[] = [
    { input: '${VALID_TOKEN}', shouldFail: false, label: 'valid ${ENV_VAR} reference' },
    { input: 'Bearer static-token', shouldFail: false, label: 'static literal value' },
    { input: '${UNCLOSED', shouldFail: true, label: 'unclosed brace' },
    { input: '${A}${B}', shouldFail: true, label: 'concatenated references' },
    { input: 'prefix-${VAR}', shouldFail: true, label: 'partial reference with prefix' },
    { input: '${VAR}-suffix', shouldFail: true, label: 'partial reference with suffix' },
    { input: '${}', shouldFail: true, label: 'empty reference' },
    { input: '${123BAD}', shouldFail: true, label: 'invalid identifier' },
  ];

  for (const { input, shouldFail, label } of cases) {
    it(`${shouldFail ? 'rejects' : 'accepts'}: ${label}`, () => {
      const data = validRegistryWithServer();
      (data.external_servers[0] as Record<string, unknown>).headers = { Authorization: input };
      const result = validateExternalMcpRegistry(data);
      if (shouldFail) {
        expect(result.ok).toBe(false);
      } else {
        expect(result.ok).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Purpose validation
// ---------------------------------------------------------------------------

describe('purpose validation', () => {
  it('rejects missing purpose', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['purpose'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.includes('purpose'))).toBe(true);
  });

  it('rejects empty purpose', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).purpose = '';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects overlong purpose', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).purpose = 'x'.repeat(MAX_PURPOSE_LENGTH + 1);
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('exceeding'))).toBe(true);
  });

  it('accepts purpose at max length', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).purpose = 'x'.repeat(MAX_PURPOSE_LENGTH);
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// preferred_for validation
// ---------------------------------------------------------------------------

describe('preferred_for validation', () => {
  it('rejects empty array', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = [];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('non-empty'))).toBe(true);
  });

  it('rejects non-array value', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = 'not an array';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects too many items', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = Array.from(
      { length: MAX_PREFERRED_FOR_ITEMS + 1 },
      (_, i) => `cue ${i}`,
    );
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('Too many'))).toBe(true);
  });

  it('rejects overlong item', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = ['x'.repeat(MAX_PREFERRED_FOR_ITEM_LENGTH + 1)];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string items', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = [123];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('accepts valid array at max items', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = Array.from(
      { length: MAX_PREFERRED_FOR_ITEMS },
      (_, i) => `cue ${i}`,
    );
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fallback_description validation
// ---------------------------------------------------------------------------

describe('fallback_description validation', () => {
  it('rejects overlong fallback_description', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).fallback_description = 'x'.repeat(MAX_FALLBACK_DESCRIPTION_LENGTH + 1);
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects empty fallback_description', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).fallback_description = '';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('accepts fallback_description at max length', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).fallback_description = 'x'.repeat(MAX_FALLBACK_DESCRIPTION_LENGTH);
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Agent scope and filtering
// ---------------------------------------------------------------------------

describe('agent scope filtering', () => {
  it('returns only enabled servers matching the agent', () => {
    const registry: ExternalMcpRegistry = {
      schema_version: 1,
      external_servers: [
        validServer({ id: 'a', agent_scope: { mode: 'allowlist', agent_ids: ['swe'] } }),
        validServer({ id: 'b', agent_scope: { mode: 'allowlist', agent_ids: ['qa'] } }),
        validServer({ id: 'c', agent_scope: { mode: 'allowlist', agent_ids: ['swe', 'qa'] } }),
      ],
    };
    const result = getExternalServersForAgent(registry, 'swe');
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('returns empty for agents not in any scope', () => {
    const registry: ExternalMcpRegistry = {
      schema_version: 1,
      external_servers: [
        validServer({ id: 'a', agent_scope: { mode: 'allowlist', agent_ids: ['swe'] } }),
      ],
    };
    const result = getExternalServersForAgent(registry, 'qa');
    expect(result).toHaveLength(0);
  });

  it('excludes disabled servers even if agent matches', () => {
    const registry: ExternalMcpRegistry = {
      schema_version: 1,
      external_servers: [
        validServer({ id: 'a', enabled: false, agent_scope: { mode: 'allowlist', agent_ids: ['swe'] } }),
      ],
    };
    const result = getExternalServersForAgent(registry, 'swe');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Schema version validation
// ---------------------------------------------------------------------------

describe('schema version validation', () => {
  it('rejects future schema version', () => {
    const result = validateExternalMcpRegistry({ schema_version: 999, external_servers: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain('newer');
  });

  it('rejects schema version 0 (below minimum)', () => {
    const result = validateExternalMcpRegistry({ schema_version: 0, external_servers: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Version 0 is caught by the "must be a positive integer" guard
    expect(result.errors[0].message).toContain('positive integer');
  });

  it('rejects non-integer schema version', () => {
    const result = validateExternalMcpRegistry({ schema_version: 1.5, external_servers: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects missing schema version', () => {
    const result = validateExternalMcpRegistry({ external_servers: [] });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation error message quality
// ---------------------------------------------------------------------------

describe('validation error message quality', () => {
  it('every error includes field, message, and fix', () => {
    const result = validateExternalMcpRegistry({
      schema_version: 'bad',
      external_servers: [{ id: '' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const error of result.errors) {
      expect(error.field).toBeTruthy();
      expect(error.message).toBeTruthy();
      expect(error.fix).toBeTruthy();
    }
  });

  it('fix text is actionable (contains a verb)', () => {
    const result = validateExternalMcpRegistry({ schema_version: 999, external_servers: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const error of result.errors) {
      expect(error.fix).toMatch(/Update|Set|Add|Remove|Use|Delete|Ensure|Keep|Run|Provide/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Corrupt file detection
// ---------------------------------------------------------------------------

describe('corrupt file detection', () => {
  it('returns actionable error for corrupt file', async () => {
    const corruptPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptPath, '{ broken json', 'utf-8');
    const result = await loadExternalMcpRegistry(corruptPath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain('Invalid JSON');
  });

  it('returns actionable error for missing file', async () => {
    const result = await loadExternalMcpRegistry(path.join(tmpDir, 'nonexistent.json'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].field).toBe(FILE_NOT_FOUND_FIELD);
    expect(result.errors[0].message).toContain('not found');
  });

  it('rejects non-object root', () => {
    const result = validateExternalMcpRegistry([]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].message).toContain('JSON object');
  });
});

// ---------------------------------------------------------------------------
// Agent scope validation
// ---------------------------------------------------------------------------

describe('agent scope validation', () => {
  it('rejects missing agent_scope', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['agent_scope'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects unsupported mode', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).agent_scope = {
      mode: 'denylist',
      agent_ids: ['swe'],
    };
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects empty agent_ids', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).agent_scope = {
      mode: 'allowlist',
      agent_ids: [],
    };
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('does NOT validate agent IDs against the agent registry', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).agent_scope = {
      mode: 'allowlist',
      agent_ids: ['nonexistent-agent-xyz'],
    };
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validServer(
  overrides: Partial<Record<string, unknown>> & { id: string },
): ExternalMcpServer {
  return {
    display_name: 'Test MCP',
    purpose: 'Test purpose',
    enabled: true,
    transport: 'sse' as const,
    url: 'https://mcp.example.com/sse',
    agent_scope: { mode: 'allowlist' as const, agent_ids: ['swe'] },
    ...overrides,
  } as ExternalMcpServer;
}

function validRegistryWithServer(): Record<string, unknown> & { external_servers: Record<string, unknown>[] } {
  return {
    schema_version: 1,
    external_servers: [{
      id: 'vendor-docs',
      display_name: 'Vendor Docs MCP',
      purpose: 'Vendor API docs',
      preferred_for: ['auth headers'],
      fallback_description: 'Provides search_docs tool',
      enabled: true,
      transport: 'sse',
      url: 'https://mcp.vendor.example/sse',
      headers: { Authorization: '${VENDOR_TOKEN}' },
      agent_scope: { mode: 'allowlist', agent_ids: ['software-engineer', 'qa'] },
    }],
  };
}
