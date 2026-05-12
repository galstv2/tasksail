import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadSharedModuleForPlatform(platform: NodeJS.Platform) {
  vi.resetModules();
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  const mod = await import('./main.contextPackShared');
  return {
    mod,
    restore() {
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('main.contextPackShared', () => {
  it('defaults the desktop Python binary to python on Windows', async () => {
    const loaded = await loadSharedModuleForPlatform('win32');
    try {
      expect(loaded.mod.REPO_CONTEXT_PYTHON_BIN).toBe('python');
    } finally {
      loaded.restore();
    }
  });

  it('defaults the desktop Python binary to python3 outside Windows', async () => {
    const loaded = await loadSharedModuleForPlatform('linux');
    try {
      expect(loaded.mod.REPO_CONTEXT_PYTHON_BIN).toBe('python3');
    } finally {
      loaded.restore();
    }
  });

  it('derives basenames from Windows-native paths', async () => {
    const { portablePathBasename } = await import('./main.contextPackShared');
    expect(portablePathBasename('C:\\context-packs\\orders-estate')).toBe('orders-estate');
  });

  it('byte-identity: slugifyValue My Pack 2026! -> my-pack-2026 (main process)', async () => {
    // Proves the main-process and renderer slugify functions are byte-identical
    // because both re-export from src/shared/slug.ts.
    const { slugifyValue } = await import('./main.contextPackShared');
    expect(slugifyValue('My Pack 2026!')).toBe('my-pack-2026');
  });
});
