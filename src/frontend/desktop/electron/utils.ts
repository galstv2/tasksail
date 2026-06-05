import {
  access as fsAccess,
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReadDir,
  rename as fsRename,
  rm as fsRm,
  writeFile as fsWriteFile,
} from 'node:fs/promises';

export type ReadOnlyRepoFs = {
  access: (path: string) => Promise<void>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
};

export type WritableRepoFs = ReadOnlyRepoFs & {
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<unknown>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  rm: (path: string, options: { recursive: true; force: true }) => Promise<unknown>;
  writeFile: (path: string, contents: string, encoding: BufferEncoding) => Promise<void>;
};

export const repoFs: ReadOnlyRepoFs = {
  access: fsAccess,
  readFile: (path, encoding) => fsReadFile(path, { encoding }),
  readdir: fsReadDir,
};

export const repoReadWriteFs: WritableRepoFs = {
  ...repoFs,
  mkdir: fsMkdir,
  rename: fsRename,
  rm: fsRm,
  writeFile: fsWriteFile,
};

export async function pathExists(
  path: string,
  fsAdapter: ReadOnlyRepoFs = repoFs,
): Promise<boolean> {
  try {
    await fsAdapter.access(path);
    return true;
  } catch {
    return false;
  }
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
