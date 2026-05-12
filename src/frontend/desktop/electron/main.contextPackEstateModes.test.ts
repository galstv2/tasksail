// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

describe('context pack estate mode IPC normalization', () => {
  it('passes platform discovery modes and estate types through verbatim', async () => {
    const { executeContextPackDiscoveryAction } = await import('./main.contextPackActions');
    const runner = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        discovery_mode: 'distributed-platform',
        estate_type: 'distributed-platform',
        warnings: [],
        candidate_repos: [],
        candidate_focus_areas: [],
        high_signal_paths: [],
      }),
      stderr: '',
    });

    const result = await executeContextPackDiscoveryAction(
      { rootPath: '/tmp/estate-root', mode: 'distributed-platform' },
      runner,
    );

    expect(runner).toHaveBeenCalledWith([
      expect.stringContaining('src/backend/scripts/python/discover-context-estate.py'),
      '--root',
      expect.stringContaining('/tmp/estate-root'),
      '--mode',
      'distributed-platform',
      '--format',
      'json',
    ]);
    expect(result).toEqual({
      ok: true,
      response: expect.objectContaining({
        action: 'contextPack.discoverPrefill',
        discoveryMode: 'distributed-platform',
        estateType: 'distributed-platform',
      }),
    });
  });
});
