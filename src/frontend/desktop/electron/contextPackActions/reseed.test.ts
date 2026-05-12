import { describe, expect, it, vi } from 'vitest';

import { executeContextPackReseedAction } from './reseed';

describe('executeContextPackReseedAction', () => {
  it('returns a structured reseed_in_progress error from reseed stdout', async () => {
    await expect(
      executeContextPackReseedAction(
        { contextPackDir: '/tmp/context-packs/orders-estate' },
        vi.fn().mockRejectedValue({
          stdout: JSON.stringify({
            error: 'reseed_in_progress',
            message: 'reseed already in progress',
            pid: 1234,
            host: 'host-a',
            started_at: '2026-05-10T12:00:00+00:00',
            same_host: true,
            stale_after_seconds: 3600,
          }),
          stderr: '',
        }),
        async () => new Set(['/tmp/context-packs/orders-estate']),
      ),
    ).resolves.toEqual({
      ok: false,
      action: 'contextPack.reseed',
      error: 'reseed_in_progress',
      details: [
        'message=reseed already in progress',
        'pid=1234',
        'host=host-a',
        'started_at=2026-05-10T12:00:00+00:00',
        'same_host=true',
        'stale_after_seconds=3600',
      ],
    });
  });
});
