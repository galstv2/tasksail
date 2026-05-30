import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

// Local (stdio) external-MCP validator cases. Split into this co-located file
// because desktopContractValidators.test.ts is at its 1500-line limit and
// cannot absorb more cases without exceeding it.
describe('externalMcp validators — local (stdio) transport', () => {
  describe('externalMcp.add / update', () => {
    it('accepts a valid local server payload (no url required)', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'local-fs', display_name: 'Local FS', purpose: 'Local filesystem tools',
            preferred_for: ['local file inspection'],
            transport: 'local', command: 'npx', tools: ['read_file'], enabled: true,
          },
        },
      });
      expect(errors).toEqual([]);
    });

    it('requires command and non-empty tools, but not url, for a local server', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'local-bad', display_name: 'Local', purpose: 'Local filesystem tools',
            preferred_for: ['local file inspection'],
            transport: 'local', enabled: true,
          },
        },
      });
      expect(errors.some((e: string) => e.includes('command'))).toBe(true);
      expect(errors.some((e: string) => e.includes('tools'))).toBe(true);
      expect(errors.some((e: string) => e.includes('url'))).toBe(false);
    });

    it('rejects a local server whose tools contain "*"', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'local-star', display_name: 'Local', purpose: 'Local filesystem tools',
            preferred_for: ['local file inspection'],
            transport: 'local', command: 'npx', tools: ['*'], enabled: true,
          },
        },
      });
      expect(errors.some((e: string) => e.includes('*'))).toBe(true);
    });

    it('still requires url for an http/sse server (regression guard)', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'url-bad', display_name: 'URL', purpose: 'Remote documentation lookup',
            preferred_for: ['vendor API questions'],
            transport: 'sse', enabled: true,
          },
        },
      });
      expect(errors.some((e: string) => e.includes('url'))).toBe(true);
    });

    it('rejects a purpose below the minimum length', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'short-purpose', display_name: 'Short', purpose: 'Local tools',
            preferred_for: ['local file inspection'],
            transport: 'local', command: 'npx', tools: ['read_file'], enabled: true,
          },
        },
      });
      expect(errors.some((e: string) => e.includes('at least 20 characters'))).toBe(true);
    });

    it('rejects missing or empty preferred_for usage cues', () => {
      const missing = validateDesktopActionRequest({
        action: 'externalMcp.add',
        payload: {
          server: {
            id: 'missing-cues', display_name: 'Missing Cues',
            purpose: 'Local filesystem tools',
            transport: 'local', command: 'npx', tools: ['read_file'], enabled: true,
          },
        },
      });
      expect(missing.some((e: string) => e.includes('preferred_for requires at least one usage cue'))).toBe(true);

      const empty = validateDesktopActionRequest({
        action: 'externalMcp.update',
        payload: {
          server: {
            id: 'empty-cues', display_name: 'Empty Cues',
            purpose: 'Local filesystem tools',
            preferred_for: ['   '],
            transport: 'local', command: 'npx', tools: ['read_file'], enabled: true,
          },
        },
      });
      expect(empty.some((e: string) => e.includes('preferred_for requires at least one usage cue'))).toBe(true);
    });
  });

  describe('externalMcp.validateLocalCommand', () => {
    it('requires a non-empty command', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateLocalCommand',
        payload: {},
      });
      expect(errors).toContain('payload.command must be a non-empty string.');
    });

    it('accepts a valid command payload', () => {
      const errors = validateDesktopActionRequest({
        action: 'externalMcp.validateLocalCommand',
        payload: { command: 'npx' },
      });
      expect(errors).toEqual([]);
    });
  });
});
