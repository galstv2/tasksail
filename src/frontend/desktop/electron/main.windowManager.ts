import { BrowserWindow, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearTerminalTaskScopeForWebContents } from './main.stream';
import { validateDevServerUrl } from './main.senderAuth';
import { getNodeErrorCode } from './main.textUtils';
import { createLogger } from './log/logger';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIST = join(__dirname, '../dist');
const PRELOAD_PATH = join(__dirname, 'preload.js');
const DEV_URL_MAX_ATTEMPTS = 20;
const DEV_URL_RETRY_DELAY_MS = 250;
const RETRYABLE_DEV_URL_ERROR_CODES = new Set([
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_ABORTED',
  'ERR_NETWORK_CHANGED',
]);

const log = createLogger('electron/main');

export class AppWindowManager {
  private mainWindow: BrowserWindow | null = null;

  async createWindow(): Promise<BrowserWindow> {
    const iconPath = join(__dirname, '..', 'build', 'icon.png');
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: '#020617',
      title: 'TaskSail',
      icon: nativeImage.createFromPath(iconPath),
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.mainWindow = window;
    const webContentsId = window.webContents?.id;
    if (typeof webContentsId === 'number') {
      window.webContents.on('destroyed', () => {
        clearTerminalTaskScopeForWebContents(webContentsId);
      });
    }
    window.once('closed', () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
      }
    });

    const isDevMode = Boolean(process.env.VITE_DEV_SERVER_URL);
    if (!isDevMode && window.webContents?.session) {
      window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; " +
              "script-src 'self'; " +
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
              "font-src 'self' https://fonts.gstatic.com; " +
              "img-src 'self' data:; " +
              "connect-src 'self'; " +
              "frame-src 'none'"
            ],
          },
        });
      });
    }

    const IDLE_GC_INTERVAL_MS = 5 * 60 * 1000;
    if (typeof window.webContents?.executeJavaScript === 'function') {
      const idleGcTimer = setInterval(() => {
        if (window.isDestroyed()) return;
        window.webContents.executeJavaScript(
          'typeof gc === "function" ? gc() : void 0',
          true,
        ).catch(() => {});
      }, IDLE_GC_INTERVAL_MS);

      window.once('closed', () => {
        clearInterval(idleGcTimer);
      });
    }

    window.once('ready-to-show', () => {
      window.show();
    });

    const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;

    if (viteDevServerUrl) {
      const validationError = validateDevServerUrl(viteDevServerUrl);
      if (validationError) {
        throw new Error(validationError);
      }

      await this.loadDevServerUrlWithRetry(window, viteDevServerUrl);
      return window;
    }

    await window.loadFile(join(RENDERER_DIST, 'index.html'));
    return window;
  }

  async loadDevServerUrlWithRetry(window: BrowserWindow, url: string): Promise<void> {
    for (let attempt = 1; attempt <= DEV_URL_MAX_ATTEMPTS; attempt++) {
      try {
        await window.loadURL(url);
        return;
      } catch (error) {
        const code = getNodeErrorCode(error);
        if (!code || !RETRYABLE_DEV_URL_ERROR_CODES.has(code)) {
          throw error;
        }
        if (attempt === DEV_URL_MAX_ATTEMPTS) {
          throw error;
        }
        if (window.isDestroyed()) {
          return;
        }
        log.info('app.dev-server.retry', { attempt, maxAttempts: DEV_URL_MAX_ATTEMPTS });
        await new Promise((resolve) => setTimeout(resolve, DEV_URL_RETRY_DELAY_MS));
        if (window.isDestroyed()) {
          return;
        }
      }
    }
  }

  focusMainWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.focus();
  }
}

const defaultWindowManager = new AppWindowManager();

export function createWindow(): Promise<BrowserWindow> {
  return defaultWindowManager.createWindow();
}

export function loadDevServerUrlWithRetry(window: BrowserWindow, url: string): Promise<void> {
  return defaultWindowManager.loadDevServerUrlWithRetry(window, url);
}

export function focusMainWindow(): void {
  defaultWindowManager.focusMainWindow();
}
