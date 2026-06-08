import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createDaltonCapsule, cleanupDaltonCapsule } from '../capsule.js';

describe('createDaltonCapsule', () => {
  it('creates an isolated tmpdir and sets cwd to rootDir', async () => {
    const capsule = await createDaltonCapsule();
    try {
      expect(capsule.rootDir).toBeTruthy();
      expect(capsule.cwd).toBe(capsule.rootDir);
      expect(existsSync(capsule.rootDir)).toBe(true);
      expect(capsule.rootDir).toContain('dalton-capsule-');
    } finally {
      await cleanupDaltonCapsule(capsule);
    }
  });

  it('cleanupDaltonCapsule removes the tmpdir', async () => {
    const capsule = await createDaltonCapsule();
    expect(existsSync(capsule.rootDir)).toBe(true);
    await cleanupDaltonCapsule(capsule);
    expect(existsSync(capsule.rootDir)).toBe(false);
  });

});
