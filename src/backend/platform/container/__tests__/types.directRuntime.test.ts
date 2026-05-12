import { describe, expect, it } from 'vitest';

import { resolveDefaultComposeFile } from '../types.js';

describe('direct runtime compose mapping', () => {
  it('keeps compose mappings for docker and podman', () => {
    expect(resolveDefaultComposeFile('docker')).toBe('runtime/docker/compose/docker-compose.yml');
    expect(resolveDefaultComposeFile('podman')).toBe('runtime/podman/compose/podman-compose.yml');
  });

  it('returns undefined for direct runtime', () => {
    expect(resolveDefaultComposeFile('direct')).toBeUndefined();
  });
});
