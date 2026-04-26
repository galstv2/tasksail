import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

async function importPlatformForWindowsTest(platform: NodeJS.Platform = 'win32') {
  vi.resetModules();
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  const execFileSync = vi.fn();
  vi.doMock('node:child_process', () => ({ execFileSync }));
  const module = await import('../platform.js');
  return { windowsVolumeRoot: module.windowsVolumeRoot, windowsVolumeFilesystemType: module.windowsVolumeFilesystemType, windowsVolumesShareReFS: module.windowsVolumesShareReFS, _resetPlatformDetectionForTests: module._resetPlatformDetectionForTests, execFileSync };
}

afterEach(() => { Object.defineProperty(process, 'platform', originalPlatformDescriptor!); vi.resetModules(); vi.doUnmock('node:child_process'); });

const cases: [string, () => Promise<void>][] = [
  ['windowsVolumeRoot returns null on darwin/linux for any input', async () => {
    expect((await importPlatformForWindowsTest('darwin')).windowsVolumeRoot('C:\\x')).toBeNull(); expect((await importPlatformForWindowsTest('linux')).windowsVolumeRoot('C:\\x')).toBeNull();
  }],
  ['windowsVolumeRoot extracts uppercased drive letter from "c:\\foo\\bar"', async () => {
    expect((await importPlatformForWindowsTest()).windowsVolumeRoot('c:\\foo\\bar')).toBe('C:\\');
  }],
  ['windowsVolumeRoot extracts the GUID prefix from a "\\\\?\\Volume{...}\\" path', async () => {
    const p = await importPlatformForWindowsTest(); expect(p.windowsVolumeRoot('\\\\?\\Volume{12345678-abcd-1234-ef00-123456789abc}\\foo')).toBe('\\\\?\\Volume{12345678-abcd-1234-ef00-123456789abc}\\');
  }],
  ['windowsVolumeFilesystemType returns null when execFileSync throws', async () => {
    const p = await importPlatformForWindowsTest(); p.execFileSync.mockImplementation(() => { throw new Error('fsutil failed'); }); expect(p.windowsVolumeFilesystemType('C:\\')).toBeNull();
  }],
  ['windowsVolumeFilesystemType parses "File System Name : ReFS" and lowercases', async () => {
    const p = await importPlatformForWindowsTest(); p.execFileSync.mockReturnValue('File System Name : ReFS'); expect(p.windowsVolumeFilesystemType('C:\\')).toBe('refs');
  }],
  ['windowsVolumeFilesystemType is memoized (second call does not invoke execFileSync)', async () => {
    const p = await importPlatformForWindowsTest(); p.execFileSync.mockReturnValue('File System Name : ReFS'); expect([p.windowsVolumeFilesystemType('C:\\'), p.windowsVolumeFilesystemType('C:\\')]).toEqual(['refs', 'refs']); expect(p.execFileSync).toHaveBeenCalledTimes(1);
  }],
  ['windowsVolumesShareReFS returns false for differing roots without invoking fsutil', async () => {
    const p = await importPlatformForWindowsTest(); expect(p.windowsVolumesShareReFS('C:\\repo', 'D:\\workspace')).toBe(false); expect(p.execFileSync).not.toHaveBeenCalled();
  }],
  ['windowsVolumesShareReFS returns true for matching roots when the root is ReFS', async () => {
    const p = await importPlatformForWindowsTest(); p.execFileSync.mockReturnValue('File System Name : ReFS'); expect(p.windowsVolumesShareReFS('C:\\repo', 'C:\\workspace')).toBe(true);
  }],
  ['windowsVolumesShareReFS returns false for matching roots when the root is NTFS', async () => {
    const p = await importPlatformForWindowsTest(); p.execFileSync.mockReturnValue('File System Name : NTFS'); expect(p.windowsVolumesShareReFS('C:\\repo', 'C:\\workspace')).toBe(false);
  }],
];

describe('Windows volume helpers', () => { it.each(cases)('%s', async (_name, run) => run()); });
