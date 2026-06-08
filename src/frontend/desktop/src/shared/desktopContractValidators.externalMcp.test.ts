// External MCP IPC action validation — split from desktopContractValidators.test.ts
// to keep that file under the size cap.
import { describe, expect, it } from 'vitest';

import {
  isValidDesktopActionRequest,
  validateDesktopActionRequest,
} from './desktopContractValidators';

describe('external MCP assignment action validation', () => {
  it('accepts a load request with no payload', () => {
    expect(validateDesktopActionRequest({ action: 'agentConfig.loadExternalMcpAssignments' })).toEqual([]);
    expect(isValidDesktopActionRequest({ action: 'agentConfig.loadExternalMcpAssignments' })).toBe(true);
  });

  it('accepts a valid save request', () => {
    const request = {
      action: 'agentConfig.saveExternalMcpAssignments',
      payload: { assignments: [{ agent_id: 'software-engineer', external_mcp_server_ids: ['vendor-docs'] }] },
    };
    expect(validateDesktopActionRequest(request)).toEqual([]);
    expect(isValidDesktopActionRequest(request)).toBe(true);
  });

  it('accepts a well-formed unrecognized agent ID (membership enforced at the save handler)', () => {
    // Structural-only dispatch validation; roster membership is enforced downstream
    // at the Electron save handler against the provider descriptor, not here.
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExternalMcpAssignments',
        payload: { assignments: [{ agent_id: 'ghost', external_mcp_server_ids: [] }] },
      }),
    ).toEqual([]);
  });

  it('rejects a save request with a missing or empty agent_id (structural check)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExternalMcpAssignments',
        payload: { assignments: [{ agent_id: '', external_mcp_server_ids: [] }] },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects a save request with non-string server IDs', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExternalMcpAssignments',
      payload: { assignments: [{ agent_id: 'qa', external_mcp_server_ids: [123] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('externalMcp validators', () => {
  describe('externalMcp.add', () => {
    it('requires a payload object', () => {
      const errors = validateDesktopActionRequest({ action: 'externalMcp.add' });
      expect(errors).toContain('payload must be an object.');
    });

    it('requires payload.server to be an object', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: { server: 'not-an-object' },
      });
      expect(errors).toContain('payload.server must be an object.');
    });

    it('requires server fields', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: { server: {} },
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e: string) => e.includes('id'))).toBe(true);
      expect(errors.some((e: string) => e.includes('purpose'))).toBe(true);
      expect(errors.some((e: string) => e.includes('url'))).toBe(true);
    });

    it('accepts valid server payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: { id: 'test', display_name: 'Test', purpose: 'Use this server for test fixtures.', preferred_for: ['test fixtures'], transport: 'sse', url: 'https://x.com', enabled: true },
        },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.update', () => {
    it('uses the same validation as add', () => {
      const errors = validateDesktopActionRequest({ action: 'externalMcp.update' });
      expect(errors).toContain('payload must be an object.');
    });

    it('accepts valid update request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.update',
        payload: {
          server: { id: 'test', display_name: 'Test', purpose: 'Use this server for test fixtures.', preferred_for: ['test fixtures'], transport: 'sse', url: 'https://x.com', enabled: true },
        },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.toggleEnabled', () => {
    it('requires payload with serverId', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.toggleEnabled',
        payload: {},
      });
      expect(errors).toContain('payload.serverId must be a non-empty string.');
    });

    it('accepts valid toggleEnabled request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.toggleEnabled',
        payload: { serverId: 'test-id' },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.remove', () => {
    it('requires payload with serverId', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.remove',
        payload: {},
      });
      expect(errors).toContain('payload.serverId must be a non-empty string.');
    });

    it('accepts valid remove request', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.remove',
        payload: { serverId: 'test-id' },
      });
      expect(errors).toEqual([]);
    });
  });

  describe('externalMcp.validateConnection', () => {
    it('requires payload with transport and url', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateConnection',
        payload: {},
      });
      expect(errors).toContain("payload.transport must be one of: 'http', 'sse'.");
    });

    it('accepts valid connection payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateConnection',
        payload: { transport: 'sse', url: 'https://x.com/sse' },
      });
      expect(errors).toEqual([]);
    });
  });
});
