// External MCP assignment IPC action validation — split from
// desktopContractValidators.test.ts to keep that file under the size cap.
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
