import {
  access as fsAccess,
  readFile as fsReadFile,
  readdir as fsReadDir,
} from 'node:fs/promises';

export type ReadOnlyRepoFs = {
  access: (path: string) => Promise<void>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
};

export const repoFs: ReadOnlyRepoFs = {
  access: fsAccess,
  readFile: (path, encoding) => fsReadFile(path, { encoding }),
  readdir: fsReadDir,
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
  return typeof value === 'number' ? value : null;
}
