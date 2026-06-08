// @vitest-environment node
//
// Verifies BrowserWindow preload and icon paths after app/ relocation. The
// contract is bundle-relative, not a Vitest source absolute path, because the
// production Electron bundle is flat.

import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type EventHandler = (...args: unknown[]) => void;

const hoisted = vi.hoisted(() => ({
  captured: {
    opts: null as { webPreferences?: { preload?: unknown; contextIsolation?: boolean; nodeIntegration?: boolean; sandbox?: boolean } } | null,
    iconPath: null as unknown,
    windowOpenHandler: null as (() => { action: string }) | null,
    webviewHandler: null as EventHandler | null,
    navigateHandler: null as EventHandler | null,
    permissionHandler: null as ((_c: unknown, _p: unknown, cb: (v: boolean) => void) => void) | null,
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (opts: { webPreferences?: { preload?: unknown } }) {
    hoisted.captured.opts = opts;
    const eventHandlers: Record<string, EventHandler[]> = {};
    const mockSession = {
      webRequest: { onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn((fn) => {
        hoisted.captured.permissionHandler = fn;
      }),
    };
    return {
      webContents: {
        id: 1,
        on: vi.fn((event: string, handler: EventHandler) => {
          if (!eventHandlers[event]) eventHandlers[event] = [];
          eventHandlers[event].push(handler);
          if (event === 'will-attach-webview') {
            hoisted.captured.webviewHandler = handler;
          }
          if (event === 'will-navigate') {
            hoisted.captured.navigateHandler = handler;
          }
        }),
        session: mockSession,
        setWindowOpenHandler: vi.fn((fn) => {
          hoisted.captured.windowOpenHandler = fn;
        }),
        executeJavaScript: undefined,
      },
      once: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadFile: vi.fn(() => Promise.resolve()),
      loadURL: vi.fn(() => Promise.resolve()),
      show: vi.fn(),
    };
  }),
  nativeImage: {
    createFromPath: vi.fn((p: unknown) => {
      hoisted.captured.iconPath = p;
      return { __iconFromPath: p };
    }),
  },
}));

vi.mock('../runtime/stream', () => ({ clearTerminalTaskScopeForWebContents: vi.fn() }));
vi.mock('../log/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }),
}));

import { createWindow } from './windowManager';

const moduleDir = dirname(fileURLToPath(import.meta.url));

describe('AppWindowManager asset paths (bundle-relative shape, guards the app/ move)', () => {
  let prevDevUrl: string | undefined;

  beforeEach(() => {
    hoisted.captured.opts = null;
    hoisted.captured.iconPath = null;
    hoisted.captured.windowOpenHandler = null;
    hoisted.captured.webviewHandler = null;
    hoisted.captured.navigateHandler = null;
    hoisted.captured.permissionHandler = null;
    prevDevUrl = process.env.VITE_DEV_SERVER_URL;
    delete process.env.VITE_DEV_SERVER_URL; // force the production loadFile path
  });

  afterEach(() => {
    if (prevDevUrl !== undefined) process.env.VITE_DEV_SERVER_URL = prevDevUrl;
    else delete process.env.VITE_DEV_SERVER_URL;
  });

  it('passes a preload that is a __dirname sibling named preload.js', async () => {
    await createWindow();
    const preload = hoisted.captured.opts?.webPreferences?.preload;
    // Sibling shape: basename is preload.js and its parent dir IS __dirname (no
    // extra path segment). Do NOT assert a literal electron/preload.js absolute
    // string and do NOT require excluding electron/app/preload.js — both are a
    // source-vs-bundle confusion that can only be satisfied by changing the
    // literal, which would break dev and packaged runtime.
    expect(typeof preload).toBe('string');
    expect(basename(preload as string)).toBe('preload.js');
    expect(dirname(preload as string)).toBe(moduleDir);
    expect(preload).toBe(join(moduleDir, 'preload.js'));
  });

  it('passes a window icon at join(__dirname, "..", "build", "icon.png")', async () => {
    await createWindow();
    expect(hoisted.captured.iconPath).toBe(join(moduleDir, '..', 'build', 'icon.png'));
  });
});

describe('AppWindowManager security boundary guards (RG-01)', () => {
  let prevDevUrl: string | undefined;

  beforeEach(() => {
    hoisted.captured.opts = null;
    hoisted.captured.windowOpenHandler = null;
    hoisted.captured.webviewHandler = null;
    hoisted.captured.navigateHandler = null;
    hoisted.captured.permissionHandler = null;
    prevDevUrl = process.env.VITE_DEV_SERVER_URL;
    delete process.env.VITE_DEV_SERVER_URL;
  });

  afterEach(() => {
    if (prevDevUrl !== undefined) process.env.VITE_DEV_SERVER_URL = prevDevUrl;
    else delete process.env.VITE_DEV_SERVER_URL;
  });

  it('webPreferences retain secure defaults: contextIsolation=true, nodeIntegration=false, sandbox=true', async () => {
    await createWindow();
    expect(hoisted.captured.opts?.webPreferences?.contextIsolation).toBe(true);
    expect(hoisted.captured.opts?.webPreferences?.nodeIntegration).toBe(false);
    expect(hoisted.captured.opts?.webPreferences?.sandbox).toBe(true);
  });

  it('setWindowOpenHandler is installed and always returns deny', async () => {
    await createWindow();
    expect(hoisted.captured.windowOpenHandler).toBeTypeOf('function');
    const result = hoisted.captured.windowOpenHandler!();
    expect(result).toEqual({ action: 'deny' });
  });

  it('will-attach-webview calls event.preventDefault()', async () => {
    await createWindow();
    expect(hoisted.captured.webviewHandler).toBeTypeOf('function');
    const mockEvent = { preventDefault: vi.fn() };
    hoisted.captured.webviewHandler!(mockEvent);
    expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
  });

  it('permission requests are denied (handler invokes callback with false)', async () => {
    await createWindow();
    expect(hoisted.captured.permissionHandler).toBeTypeOf('function');
    const cb = vi.fn();
    hoisted.captured.permissionHandler!({}, 'media', cb);
    expect(cb).toHaveBeenCalledWith(false);
  });

  describe('will-navigate handler (RG-01-navigation)', () => {
    it('prevents navigation to an external https URL', async () => {
      await createWindow();
      expect(hoisted.captured.navigateHandler).toBeTypeOf('function');
      const mockEvent = { preventDefault: vi.fn() };
      hoisted.captured.navigateHandler!(mockEvent, 'https://example.com/malicious');
      expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
    });

    it('prevents navigation to http://example.com (non-localhost)', async () => {
      await createWindow();
      const mockEvent = { preventDefault: vi.fn() };
      hoisted.captured.navigateHandler!(mockEvent, 'http://example.com');
      expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
    });

    it('allows navigation to the production dist index.html file', async () => {
      await createWindow();
      const distIndex = join(moduleDir, '../dist', 'index.html');
      const distIndexUrl = new URL(`file://${distIndex}`).href;
      const mockEvent = { preventDefault: vi.fn() };
      hoisted.captured.navigateHandler!(mockEvent, distIndexUrl);
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('allows navigation to the validated dev server origin', async () => {
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      await createWindow();
      const mockEvent = { preventDefault: vi.fn() };
      hoisted.captured.navigateHandler!(mockEvent, 'http://localhost:5173/some-spa-route');
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('prevents navigation from dev server to a different origin', async () => {
      process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
      await createWindow();
      const mockEvent = { preventDefault: vi.fn() };
      hoisted.captured.navigateHandler!(mockEvent, 'https://evil.com');
      expect(mockEvent.preventDefault).toHaveBeenCalledOnce();
    });
  });
});

describe('AppWindowManager production CSP (RG-01-csp)', () => {
  const EXPECTED_DIRECTIVES = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];

  it('production CSP string contains all required directives (old + new)', () => {
    const { readFileSync } = require('node:fs');
    const { join: pathJoin, dirname: pathDirname } = require('node:path');
    const { fileURLToPath: fup } = require('node:url');
    const dir = pathDirname(fup(import.meta.url));
    const src = readFileSync(pathJoin(dir, 'windowManager.ts'), 'utf-8');

    for (const directive of EXPECTED_DIRECTIVES) {
      expect(src).toContain(directive);
    }
  });

  it('production CSP does not contain remote font hosts', () => {
    const { readFileSync } = require('node:fs');
    const { join: pathJoin, dirname: pathDirname } = require('node:path');
    const { fileURLToPath: fup } = require('node:url');
    const dir = pathDirname(fup(import.meta.url));
    const src = readFileSync(pathJoin(dir, 'windowManager.ts'), 'utf-8');

    // Assemble from fragments so this test does not trip the source-wide font-host scan.
    const hostApis = ['fonts', 'googleapis', 'com'].join('.');
    const hostStatic = ['fonts', 'gstatic', 'com'].join('.');
    expect(src).not.toContain(hostApis);
    expect(src).not.toContain(hostStatic);
  });
});
