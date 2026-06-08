// @vitest-environment node

import { win32 as winPath, posix as posixPath, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  isFileUrlInsideDist,
  validateDesktopInvokeSender,
  validateDevServerUrl,
} from './senderAuth';

// ── isFileUrlInsideDist ───────────────────────────────────────────────────────

describe('isFileUrlInsideDist (pure path check)', () => {
  describe('POSIX paths', () => {
    const sep = posixPath.sep; // '/'

    it('accepts the dist root itself', () => {
      expect(isFileUrlInsideDist('/app/dist', '/app/dist', sep)).toBe(true);
    });

    it('accepts a file directly inside dist', () => {
      expect(isFileUrlInsideDist('/app/dist/index.html', '/app/dist', sep)).toBe(true);
    });

    it('accepts a nested file inside dist', () => {
      expect(isFileUrlInsideDist('/app/dist/assets/main.js', '/app/dist', sep)).toBe(true);
    });

    it('rejects a prefix-sibling directory (dist-extra)', () => {
      expect(isFileUrlInsideDist('/app/dist-extra/index.html', '/app/dist', sep)).toBe(false);
    });

    it('rejects a sibling directory with a similar name', () => {
      expect(isFileUrlInsideDist('/app/distributor/index.html', '/app/dist', sep)).toBe(false);
    });

    it('rejects a completely unrelated path', () => {
      expect(isFileUrlInsideDist('/tmp/evil.html', '/app/dist', sep)).toBe(false);
    });

    it('rejects a path that is a parent of dist', () => {
      expect(isFileUrlInsideDist('/app', '/app/dist', sep)).toBe(false);
    });

    it('is case-SENSITIVE on POSIX (different casing is a different path)', () => {
      expect(isFileUrlInsideDist('/app/Dist/index.html', '/app/dist', sep)).toBe(false);
    });
  });

  describe('Windows paths', () => {
    const sep = winPath.sep; // '\\'

    it('accepts the dist root itself', () => {
      expect(isFileUrlInsideDist('C:\\app\\dist', 'C:\\app\\dist', sep)).toBe(true);
    });

    it('accepts a file directly inside dist', () => {
      expect(isFileUrlInsideDist('C:\\app\\dist\\index.html', 'C:\\app\\dist', sep)).toBe(true);
    });

    it('accepts a nested file inside dist', () => {
      expect(isFileUrlInsideDist('C:\\app\\dist\\assets\\main.js', 'C:\\app\\dist', sep)).toBe(true);
    });

    it('rejects a prefix-sibling directory (dist-extra)', () => {
      expect(isFileUrlInsideDist('C:\\app\\dist-extra\\index.html', 'C:\\app\\dist', sep)).toBe(false);
    });

    it('rejects a sibling directory with similar name', () => {
      expect(isFileUrlInsideDist('C:\\app\\distributor\\index.html', 'C:\\app\\dist', sep)).toBe(false);
    });

    it('normalizes upper-case drive letter to lower-case (Windows casing safety)', () => {
      // Sender URL decoded to upper-case drive; dist resolved with lower-case.
      expect(isFileUrlInsideDist('C:\\app\\dist\\index.html', 'c:\\app\\dist', sep)).toBe(true);
    });

    it('normalizes lower-case drive letter vs upper-case dist (Windows casing safety)', () => {
      expect(isFileUrlInsideDist('c:\\app\\dist\\index.html', 'C:\\app\\dist', sep)).toBe(true);
    });

    it('rejects cross-drive path', () => {
      expect(isFileUrlInsideDist('D:\\app\\dist\\index.html', 'C:\\app\\dist', sep)).toBe(false);
    });

    it('accepts mixed segment casing (Windows filesystem is case-insensitive)', () => {
      // The renderer's reported casing can differ from RENDERER_DIST beyond the
      // drive letter; a legitimate sender must still be authorized on Windows.
      expect(isFileUrlInsideDist('c:\\app\\dist\\index.html', 'C:\\App\\Dist', sep)).toBe(true);
      expect(isFileUrlInsideDist('C:\\APP\\DIST\\assets\\main.js', 'c:\\app\\dist', sep)).toBe(true);
    });

    it('still rejects a prefix-sibling even with mixed casing', () => {
      expect(isFileUrlInsideDist('C:\\App\\Dist-Extra\\x.html', 'c:\\app\\dist', sep)).toBe(false);
    });
  });
});

// ── validateDevServerUrl ──────────────────────────────────────────────────────

describe('validateDevServerUrl', () => {
  it('accepts http://localhost URLs', () => {
    expect(validateDevServerUrl('http://localhost:5173')).toBeNull();
  });

  it('accepts http://127.0.0.1 URLs', () => {
    expect(validateDevServerUrl('http://127.0.0.1:5173')).toBeNull();
  });

  it('rejects https', () => {
    expect(validateDevServerUrl('https://localhost:5173')).not.toBeNull();
  });

  it('rejects non-localhost hosts', () => {
    expect(validateDevServerUrl('http://evil.com:5173')).not.toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(validateDevServerUrl('not-a-url')).not.toBeNull();
  });
});

// ── validateDesktopInvokeSender ───────────────────────────────────────────────

describe('validateDesktopInvokeSender', () => {
  it('rejects when senderFrame is null', () => {
    expect(validateDesktopInvokeSender({ senderFrame: null })).not.toBeNull();
  });

  it('rejects when senderFrame url is empty', () => {
    expect(validateDesktopInvokeSender({ senderFrame: { url: '' } })).not.toBeNull();
  });

  it('rejects non-file:// senders in production mode', () => {
    // Ensure dev server env var is absent.
    const prev = process.env.VITE_DEV_SERVER_URL;
    delete process.env.VITE_DEV_SERVER_URL;
    try {
      expect(
        validateDesktopInvokeSender({ senderFrame: { url: 'https://evil.com/index.html' } }),
      ).not.toBeNull();
    } finally {
      if (prev !== undefined) process.env.VITE_DEV_SERVER_URL = prev;
    }
  });

  it('accepts a valid dev server origin', () => {
    const prev = process.env.VITE_DEV_SERVER_URL;
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    try {
      expect(
        validateDesktopInvokeSender({ senderFrame: { url: 'http://localhost:5173/index.html' } }),
      ).toBeNull();
    } finally {
      if (prev !== undefined) {
        process.env.VITE_DEV_SERVER_URL = prev;
      } else {
        delete process.env.VITE_DEV_SERVER_URL;
      }
    }
  });

  it('rejects a mismatched dev server origin', () => {
    const prev = process.env.VITE_DEV_SERVER_URL;
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    try {
      expect(
        validateDesktopInvokeSender({ senderFrame: { url: 'http://localhost:9999/index.html' } }),
      ).not.toBeNull();
    } finally {
      if (prev !== undefined) {
        process.env.VITE_DEV_SERVER_URL = prev;
      } else {
        delete process.env.VITE_DEV_SERVER_URL;
      }
    }
  });
});

// ── RENDERER_DIST bundle-relative shape (guards the app/ move) ─────────────────
//
// RENDERER_DIST in senderAuth.ts is join(__dirname, '../dist'); __dirname is the
// module dir (electron/app under Vitest — the same dir as THIS test — and
// dist-electron at runtime). A renderer file at __dirname/../dist must be
// authorized; an erroneous deeper join ('../../dist') introduced during the move
// would reject it and break production IPC sender authorization. These behavioral
// assertions catch that without depending on a source-context absolute string.

describe('RENDERER_DIST bundle-relative shape (guards the app/ move)', () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));

  const withProdEnv = (fn: () => void): void => {
    const prev = process.env.VITE_DEV_SERVER_URL;
    delete process.env.VITE_DEV_SERVER_URL; // force the file:// production path
    try {
      fn();
    } finally {
      if (prev !== undefined) process.env.VITE_DEV_SERVER_URL = prev;
    }
  };

  it('authorizes a renderer file URL inside join(__dirname, "../dist")', () => {
    withProdEnv(() => {
      const url = pathToFileURL(join(moduleDir, '../dist', 'index.html')).href;
      expect(validateDesktopInvokeSender({ senderFrame: { url } })).toBeNull();
    });
  });

  it('rejects a renderer file URL one level deeper than RENDERER_DIST ("../../dist")', () => {
    withProdEnv(() => {
      const url = pathToFileURL(join(moduleDir, '../../dist', 'index.html')).href;
      expect(validateDesktopInvokeSender({ senderFrame: { url } })).not.toBeNull();
    });
  });
});
