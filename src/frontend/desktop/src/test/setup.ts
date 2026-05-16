import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

const bootstrapInfo = {
  appName: 'TaskSail',
  platform: 'test',
  logLevel: 'info',
  rendererForwardLevel: 'info',
  versions: { chrome: undefined, electron: undefined, node: 'test' },
};

function installDesktopShellLoggerStub(): void {
  if (typeof window === 'undefined') return;
  const existing = window.desktopShell;
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      ...existing,
      getBootstrapInfo: existing?.getBootstrapInfo ?? vi.fn(() => Promise.resolve(bootstrapInfo)),
      log: {
        ...existing?.log,
        emit: existing?.log?.emit ?? vi.fn(() => Promise.resolve({ ok: true })),
      },
    },
  });
}

installDesktopShellLoggerStub();

beforeEach(() => {
  installDesktopShellLoggerStub();
});
