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
  FILE_NOT_FOUND_FIELD,
} from '../load.js';
import {
  CURRENT_SCHEMA_VERSION,
  ALLOWED_TRANSPORTS,
  MAX_PURPOSE_LENGTH,
  MIN_PURPOSE_LENGTH,
  MAX_PREFERRED_FOR_ITEM_LENGTH,
  MAX_PREFERRED_FOR_ITEMS,
  MAX_FALLBACK_DESCRIPTION_LENGTH,
} from '../types.js';
import type { ExternalMcpRegistry } from '../types.js';

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
    expect(result.registry.external_servers[0].purpose).toBe('Vendor API docs for billing');
    expect(result.registry.external_servers[0].preferred_for).toEqual(['auth headers']);
    expect(result.registry.external_servers[0].fallback_description).toBe('Provides search_docs tool');
  });

  it('accepts a valid server without optional fallback and connection metadata fields', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['fallback_description'];
    delete (data.external_servers[0] as Record<string, unknown>)['headers'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const server = result.registry.external_servers[0];
    expect(server.preferred_for).toEqual(['auth headers']);
    expect(server.fallback_description).toBeUndefined();
    if (server.transport !== 'local') {
      expect(server.headers).toBeUndefined();
    }
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
  // The url-shaped fixture is valid for http/sse; 'local' has a distinct shape
  // and is covered by the dedicated local-transport suite below.
  for (const transport of ALLOWED_TRANSPORTS.filter((t) => t !== 'local')) {
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
// Local (stdio) transport validation
// ---------------------------------------------------------------------------

describe('local transport validation', () => {
  function localRegistry(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> & { external_servers: Record<string, unknown>[] } {
    return {
      schema_version: 1,
      external_servers: [{
        id: 'local-fs',
        display_name: 'Local FS MCP',
        purpose: 'Local filesystem tools',
        preferred_for: ['local filesystem inspection'],
        enabled: true,
        transport: 'local',
        command: 'npx',
        args: ['-y', '@scope/server'],
        tools: ['read_file', 'list_dir'],
        agent_scope: { mode: 'allowlist', agent_ids: ['software-engineer'] },
        ...overrides,
      }],
    };
  }

  it('accepts a valid local server with command and tools', () => {
    const result = validateExternalMcpRegistry(localRegistry());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const server = result.registry.external_servers[0];
    expect(server.transport).toBe('local');
    if (server.transport !== 'local') return;
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', '@scope/server']);
    expect(server.tools).toEqual(['read_file', 'list_dir']);
  });

  it('accepts a local server with env ${ENV_VAR} references and an absolute cwd', () => {
    const result = validateExternalMcpRegistry(localRegistry({
      env: { API_KEY: '${VENDOR_TOKEN}', MODE: 'prod' },
      cwd: process.cwd(),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const server = result.registry.external_servers[0];
    if (server.transport !== 'local') return;
    expect(server.env).toEqual({ API_KEY: '${VENDOR_TOKEN}', MODE: 'prod' });
    expect(server.cwd).toBe(process.cwd());
  });

  it('rejects a local server missing command', () => {
    const data = localRegistry();
    delete (data.external_servers[0] as Record<string, unknown>)['command'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.endsWith('.command'))).toBe(true);
  });

  it('rejects a local server whose tools contain "*"', () => {
    const result = validateExternalMcpRegistry(localRegistry({ tools: ['*'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.endsWith('.tools') && e.message.includes('*'))).toBe(true);
  });

  it('rejects a local server with an empty tools allowlist', () => {
    const result = validateExternalMcpRegistry(localRegistry({ tools: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a local server missing tools entirely', () => {
    const data = localRegistry();
    delete (data.external_servers[0] as Record<string, unknown>)['tools'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects a local server with a relative cwd', () => {
    const result = validateExternalMcpRegistry(localRegistry({ cwd: 'relative/dir' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.endsWith('.cwd'))).toBe(true);
  });

  it('rejects a local server with a malformed env reference', () => {
    const result = validateExternalMcpRegistry(localRegistry({
      env: { API_KEY: 'Bearer ${TOKEN}' },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.includes('.env'))).toBe(true);
  });

  it('rejects a local server that also declares a url', () => {
    const result = validateExternalMcpRegistry(localRegistry({ url: 'https://example.com/mcp' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.endsWith('.url'))).toBe(true);
  });

  it('rejects a local server that also declares headers', () => {
    const result = validateExternalMcpRegistry(localRegistry({ headers: { Authorization: '${TOKEN}' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.field.endsWith('.headers'))).toBe(true);
  });
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

  it('rejects purpose below the minimum length', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).purpose = 'short purpose';
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes(`at least ${MIN_PURPOSE_LENGTH} characters`))).toBe(true);
  });

  it('accepts purpose at the minimum length', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).purpose = 'x'.repeat(MIN_PURPOSE_LENGTH);
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
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
  it('rejects missing preferred_for', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['preferred_for'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('requires at least one usage cue'))).toBe(true);
  });

  it('rejects empty array', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).preferred_for = [];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('requires at least one usage cue'))).toBe(true);
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
// Stale agent_scope handling (no longer assignment data)
// ---------------------------------------------------------------------------

describe('stale agent_scope handling', () => {
  it('accepts a server with no agent_scope', () => {
    const data = validRegistryWithServer();
    delete (data.external_servers[0] as Record<string, unknown>)['agent_scope'];
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('strips a stale agent_scope from normalized output', () => {
    const data = validRegistryWithServer(); // fixture carries agent_scope
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('agent_scope' in result.registry.external_servers[0]).toBe(false);
  });

  it('tolerates a malformed stale agent_scope (ignored, not validated)', () => {
    const data = validRegistryWithServer();
    (data.external_servers[0] as Record<string, unknown>).agent_scope = {
      mode: 'denylist',
      agent_ids: [],
    };
    const result = validateExternalMcpRegistry(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('agent_scope' in result.registry.external_servers[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validRegistryWithServer(): Record<string, unknown> & { external_servers: Record<string, unknown>[] } {
  return {
    schema_version: 1,
    external_servers: [{
      id: 'vendor-docs',
      display_name: 'Vendor Docs MCP',
      purpose: 'Vendor API docs for billing',
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
