import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  copyTreeFast,
  type CopyTreeFastDeps,
  type CopyTreeSelectedStrategy,
} from '../copyTreeFast.js';

function makeDeps(
  platform: NodeJS.Platform,
  options: {
    execFile?: CopyTreeFastDeps['execFile'];
    nodeCopy?: CopyTreeFastDeps['nodeCopy'];
    reflinkTreeWindows?: CopyTreeFastDeps['reflinkTreeWindows'];
    nowValues?: number[];
  } = {},
): CopyTreeFastDeps {
  const nowValues = [...(options.nowValues ?? [10, 25])];
  return {
    platform,
    execFile: options.execFile ?? vi.fn().mockResolvedValue({}),
    nodeCopy: options.nodeCopy ?? vi.fn().mockResolvedValue(undefined),
    reflinkTreeWindows: options.reflinkTreeWindows ?? vi.fn().mockResolvedValue(undefined),
    now: vi.fn(() => nowValues.shift() ?? 25),
  };
}

function errorWithCode(code: string | number): Error & { code: string | number } {
  return Object.assign(new Error(String(code)), { code });
}

describe('copyTreeFast platform ladders', () => {
  it('Linux selected reflink uses cp -a --reflink=always and reports reflink on success', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const deps = makeDeps('linux', { execFile });

    const result = await copyTreeFast('/src', '/dst', 'reflink', deps);

    expect(execFile).toHaveBeenCalledWith('cp', ['-a', '--reflink=always', '/src', '/dst']);
    expect(result).toMatchObject({
      selectedStrategy: 'reflink',
      effectiveStrategy: 'reflink',
      reflinkAttempted: true,
      reflinkUsed: true,
      fallbackReason: null,
    });
  });

  it('Linux selected reflink falls back to cp -a with a fallback reason', async () => {
    const execFile = vi.fn()
      .mockRejectedValueOnce(errorWithCode('EXDEV'))
      .mockResolvedValueOnce({});
    const deps = makeDeps('linux', { execFile });

    const result = await copyTreeFast('/src', '/dst', 'reflink', deps);

    expect(execFile).toHaveBeenNthCalledWith(1, 'cp', ['-a', '--reflink=always', '/src', '/dst']);
    expect(execFile).toHaveBeenNthCalledWith(2, 'cp', ['-a', '/src', '/dst']);
    expect(result.effectiveStrategy).toBe('native-copy');
    expect(result.fallbackReason).toBe('EXDEV');
    expect(result.reflinkUsed).toBe(false);
  });

  it('Linux selected reflink falls back to Node fs.cp when native copy also fails', async () => {
    const execFile = vi.fn()
      .mockRejectedValueOnce(errorWithCode('EXDEV'))
      .mockRejectedValueOnce(errorWithCode('EIO'));
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('linux', { execFile, nodeCopy });

    const result = await copyTreeFast('/src', '/dst', 'reflink', deps);

    expect(execFile).toHaveBeenNthCalledWith(1, 'cp', ['-a', '--reflink=always', '/src', '/dst']);
    expect(execFile).toHaveBeenNthCalledWith(2, 'cp', ['-a', '/src', '/dst']);
    expect(nodeCopy).toHaveBeenCalledWith('/src', '/dst');
    expect(result.effectiveStrategy).toBe('node-copy');
    expect(result.fallbackReason).toBe('EXDEV');
    expect(result.reflinkUsed).toBe(false);
  });

  it('Linux selected copy uses cp -a before Node fs.cp', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('linux', { execFile, nodeCopy });

    const result = await copyTreeFast('/src', '/dst', 'copy', deps);

    expect(execFile).toHaveBeenCalledWith('cp', ['-a', '/src', '/dst']);
    expect(nodeCopy).not.toHaveBeenCalled();
    expect(result.effectiveStrategy).toBe('native-copy');
  });

  it('WSL follows the Linux ladder through platform linux without path translation', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const deps = makeDeps('linux', { execFile });

    await copyTreeFast('/mnt/c/repo/deps', '/mnt/c/wt/deps', 'copy', deps);

    expect(execFile).toHaveBeenCalledWith('cp', ['-a', '/mnt/c/repo/deps', '/mnt/c/wt/deps']);
  });

  it('macOS selected apfs-clonefile uses cp -cR, then cp -pR, then Node fs.cp', async () => {
    const execFile = vi.fn()
      .mockRejectedValueOnce(errorWithCode('ENOTSUP'))
      .mockRejectedValueOnce(errorWithCode('EIO'));
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('darwin', { execFile, nodeCopy });

    const result = await copyTreeFast('/src', '/dst', 'apfs-clonefile', deps);

    expect(execFile).toHaveBeenNthCalledWith(1, 'cp', ['-cR', '/src', '/dst']);
    expect(execFile).toHaveBeenNthCalledWith(2, 'cp', ['-pR', '/src', '/dst']);
    expect(nodeCopy).toHaveBeenCalledWith('/src', '/dst');
    expect(result.effectiveStrategy).toBe('node-copy');
    expect(result.fallbackReason).toBe('ENOTSUP');
  });

  it('macOS selected copy uses cp -pR before Node fs.cp', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('darwin', { execFile, nodeCopy });

    const result = await copyTreeFast('/src', '/dst', 'copy', deps);

    expect(execFile).toHaveBeenCalledWith('cp', ['-pR', '/src', '/dst']);
    expect(nodeCopy).not.toHaveBeenCalled();
    expect(result.effectiveStrategy).toBe('native-copy');
  });

  it('Windows selected win-refs uses @reflink/reflink when successful', async () => {
    const reflinkTreeWindows = vi.fn().mockResolvedValue(undefined);
    const execFile = vi.fn().mockResolvedValue({});
    const deps = makeDeps('win32', { reflinkTreeWindows, execFile });

    const result = await copyTreeFast('C:\\src', 'C:\\dst', 'win-refs', deps);

    expect(reflinkTreeWindows).toHaveBeenCalledWith('C:\\src', 'C:\\dst');
    expect(execFile).not.toHaveBeenCalled();
    expect(result.effectiveStrategy).toBe('win-refs');
    expect(result.reflinkUsed).toBe(true);
  });

  it('Windows win-refs bounded traversal copies nested files and symlinks', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-tree-fast-'));
    const src = path.join(tempRoot, 'src');
    const dst = path.join(tempRoot, 'dst');
    vi.doMock('@reflink/reflink', () => ({
      default: {
        reflinkFileSync: vi.fn((source: string, destination: string) => {
          fs.copyFileSync(source, destination);
          return 0;
        }),
      },
      reflinkFileSync: vi.fn((source: string, destination: string) => {
        fs.copyFileSync(source, destination);
        return 0;
      }),
    }));

    try {
      fs.mkdirSync(path.join(src, 'a', 'deep'), { recursive: true });
      fs.mkdirSync(path.join(src, 'b'), { recursive: true });
      for (let index = 0; index < 48; index += 1) {
        fs.writeFileSync(path.join(src, 'a', `file-${index}.txt`), `file ${index}`, 'utf-8');
      }
      fs.writeFileSync(path.join(src, 'a', 'deep', 'nested.txt'), 'nested', 'utf-8');
      fs.writeFileSync(path.join(src, 'b', 'target.txt'), 'target', 'utf-8');
      fs.symlinkSync('../b/target.txt', path.join(src, 'a', 'target-link.txt'));

      const result = await copyTreeFast(src, dst, 'win-refs', {
        platform: 'win32',
        now: vi.fn()
          .mockReturnValueOnce(100)
          .mockReturnValueOnce(125),
      });

      expect(result.effectiveStrategy).toBe('win-refs');
      expect(fs.readFileSync(path.join(dst, 'a', 'file-47.txt'), 'utf-8')).toBe('file 47');
      expect(fs.readFileSync(path.join(dst, 'a', 'deep', 'nested.txt'), 'utf-8')).toBe('nested');
      expect(fs.readlinkSync(path.join(dst, 'a', 'target-link.txt'))).toBe('../b/target.txt');
    } finally {
      vi.doUnmock('@reflink/reflink');
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('Windows selected win-refs falls back to robocopy on recoverable reflink failure', async () => {
    const reflinkTreeWindows = vi.fn().mockRejectedValue(errorWithCode('EXDEV'));
    const execFile = vi.fn().mockResolvedValue({});
    const deps = makeDeps('win32', { reflinkTreeWindows, execFile });

    const result = await copyTreeFast('C:\\src', 'C:\\dst', 'win-refs', deps);

    expect(execFile).toHaveBeenCalledWith('robocopy', [
      'C:\\src',
      'C:\\dst',
      '/E',
      '/COPY:DAT',
      '/DCOPY:DAT',
      '/R:2',
      '/W:1',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
    ], { windowsHide: true });
    expect(result.effectiveStrategy).toBe('native-copy');
    expect(result.fallbackReason).toBe('EXDEV');
  });

  it.each([0, 1, 7])('Windows robocopy exit code %i is success', async (code) => {
    const execFile = vi.fn().mockRejectedValue(errorWithCode(code));
    const deps = makeDeps('win32', { execFile });

    const result = await copyTreeFast('C:\\src', 'C:\\dst', 'copy', deps);

    expect(result.effectiveStrategy).toBe('native-copy');
  });

  it('Windows robocopy exit code 8 falls back to Node fs.cp and throws if Node copy fails', async () => {
    const execFile = vi.fn().mockRejectedValue(errorWithCode(8));
    const nodeCopyError = errorWithCode('EIO');
    const nodeCopy = vi.fn().mockRejectedValue(nodeCopyError);
    const deps = makeDeps('win32', { execFile, nodeCopy });

    await expect(copyTreeFast('C:\\src', 'C:\\dst', 'copy', deps)).rejects.toBe(nodeCopyError);
    expect(nodeCopy).toHaveBeenCalledWith('C:\\src', 'C:\\dst');
  });

  it('Windows selected copy uses robocopy before Node fs.cp', async () => {
    const execFile = vi.fn().mockResolvedValue({});
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('win32', { execFile, nodeCopy });

    const result = await copyTreeFast('C:\\src', 'C:\\dst', 'copy', deps);

    expect(execFile).toHaveBeenCalledWith('robocopy', expect.any(Array), { windowsHide: true });
    expect(nodeCopy).not.toHaveBeenCalled();
    expect(result.effectiveStrategy).toBe('native-copy');
  });

  it('Non-recoverable win-refs reflink errors throw without robocopy or Node fs.cp', async () => {
    const reflinkTreeWindows = vi.fn().mockRejectedValue(errorWithCode('EACCES'));
    const execFile = vi.fn().mockResolvedValue({});
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps('win32', { reflinkTreeWindows, execFile, nodeCopy });

    await expect(copyTreeFast('C:\\src', 'C:\\dst', 'win-refs', deps)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(execFile).not.toHaveBeenCalled();
    expect(nodeCopy).not.toHaveBeenCalled();
  });

  it.each([
    ['linux', 'copy'] as [NodeJS.Platform, CopyTreeSelectedStrategy],
    ['darwin', 'copy'] as [NodeJS.Platform, CopyTreeSelectedStrategy],
    ['win32', 'copy'] as [NodeJS.Platform, CopyTreeSelectedStrategy],
  ])('Native-copy failure on %s falls back to Node fs.cp and reports node-copy', async (platform, strategy) => {
    const execFile = vi.fn().mockRejectedValue(errorWithCode('EIO'));
    const nodeCopy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps(platform, { execFile, nodeCopy });

    const result = await copyTreeFast('/src', '/dst', strategy, deps);

    expect(nodeCopy).toHaveBeenCalledWith('/src', '/dst');
    expect(result.effectiveStrategy).toBe('node-copy');
    expect(result.fallbackReason).toBe('EIO');
  });

  it('Duration is deterministic through injected clock', async () => {
    const deps = makeDeps('linux', { nowValues: [100, 157] });

    const result = await copyTreeFast('/src', '/dst', 'copy', deps);

    expect(result.durationMs).toBe(57);
  });
});
