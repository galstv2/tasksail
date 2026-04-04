// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const loadURL = vi.fn(async () => undefined);
const loadFile = vi.fn(async () => undefined);
const show = vi.fn();
const once = vi.fn((event: string, callback: () => void) => {
  if (event === 'ready-to-show') {
    callback();
  }
});

const browserWindowInstance = {
  loadFile,
  loadURL,
  once,
  show,
};

const BrowserWindowMock = vi.fn(() => browserWindowInstance) as unknown as {
  (): typeof browserWindowInstance;
  getAllWindows: ReturnType<typeof vi.fn>;
};
BrowserWindowMock.getAllWindows = vi.fn(() => []);

const appMock = {
  on: vi.fn(),
  quit: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
};

const dialogMock = {
  showOpenDialog: vi.fn(),
};

const ipcMainMock = {
  handle: vi.fn(),
};

vi.mock('electron', () => ({
  app: appMock,
  BrowserWindow: BrowserWindowMock,
  dialog: dialogMock,
  ipcMain: ipcMainMock,
  nativeImage: {
    createFromPath: vi.fn().mockReturnValue({ isEmpty: () => false }),
  },
}));

describe('cross-platform packaging utilities', () => {
  it('getPackageOutputDir returns correct directory per platform and arch', async () => {
    const { getPackageOutputDir } = await import('./main');
    const rel = '/test/release';

    expect(getPackageOutputDir(rel, 'darwin', 'arm64')).toBe(join(rel, 'mac-arm64'));
    expect(getPackageOutputDir(rel, 'darwin', 'x64')).toBe(join(rel, 'mac'));
    expect(getPackageOutputDir(rel, 'win32', 'x64')).toBe(join(rel, 'win-unpacked'));
    expect(getPackageOutputDir(rel, 'linux', 'x64')).toBe(join(rel, 'linux-unpacked'));
    expect(getPackageOutputDir(rel, 'sunos' as NodeJS.Platform, 'x64')).toBe(join(rel, 'unsupported-platform'));
  });

  it('getPackageArtifactName returns correct artifact per platform', async () => {
    const { getPackageArtifactName } = await import('./main');

    expect(getPackageArtifactName('darwin')).toBe('TaskSail.app');
    expect(getPackageArtifactName('win32')).toBe('TaskSail Setup.exe');
    expect(getPackageArtifactName('linux')).toBe('TaskSail.AppImage');
    expect(getPackageArtifactName('sunos' as NodeJS.Platform)).toBe('TaskSail artifact');
  });

  it('getPackageCommand returns correct npm script per platform', async () => {
    const { getPackageCommand } = await import('./main');

    expect(getPackageCommand('darwin')).toBe('npm run package:mac');
    expect(getPackageCommand('win32')).toBe('npm run package:win');
    expect(getPackageCommand('linux')).toBe('npm run package:linux');
    expect(getPackageCommand('sunos' as NodeJS.Platform)).toBe(
      'No native packaging command is configured for this host platform.',
    );
  });
});
