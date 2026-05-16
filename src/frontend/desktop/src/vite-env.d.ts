/// <reference types="vite/client" />

import type { DesktopShellApi } from '../electron/preload';

type BootstrapInfo = {
  appName: string;
  platform: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rendererForwardLevel: 'debug' | 'info' | 'warn' | 'error';
  versions: {
    chrome: string | undefined;
    electron: string | undefined;
    node: string;
  };
};

declare global {
  interface Window {
    desktopShell: DesktopShellApi & {
      getBootstrapInfo: () => Promise<BootstrapInfo>;
    };
  }
}

export {};
