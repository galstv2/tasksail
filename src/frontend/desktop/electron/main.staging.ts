import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReadDir,
  stat as fsStat,
  unlink as fsUnlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { StagedDraftContent } from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';
import { getNodeErrorCode } from './main.textUtils';

const DROPBOX_DIR = join(REPO_ROOT, 'AgentWorkSpace', 'dropbox');
const STAGING_DIR = join(DROPBOX_DIR, '.staging');

export type StagedDraftReadResult = {
  draft: StagedDraftContent | null;
  error: string | null;
};

export async function readStagedDraft(): Promise<StagedDraftReadResult> {
  try {
    const entries = await fsReadDir(STAGING_DIR);
    const mdFiles = entries.filter((f) => f.endsWith('.md'));
    if (mdFiles.length === 0) {
      return { draft: null, error: null };
    }

    let newest: { name: string; mtime: Date } | null = null;
    for (const name of mdFiles) {
      const info = await fsStat(join(STAGING_DIR, name));
      if (!newest || info.mtimeMs > newest.mtime.getTime()) {
        newest = { name, mtime: info.mtime };
      }
    }
    if (!newest) {
      return { draft: null, error: null };
    }

    const content = await fsReadFile(join(STAGING_DIR, newest.name), 'utf-8');
    if (content.trim().length === 0) {
      return {
        draft: null,
        error: `Staged draft ${newest.name} is empty. Ask Lily to rewrite the draft before finalizing.`,
      };
    }

    return {
      draft: {
        filename: newest.name,
        content,
        modifiedAt: newest.mtime.toISOString(),
      },
      error: null,
    };
  } catch (error: unknown) {
    if (getNodeErrorCode(error) === 'ENOENT') {
      return { draft: null, error: null };
    }

    return {
      draft: null,
      error: error instanceof Error ? error.message : 'Failed to read staged draft.',
    };
  }
}

export async function clearStagingDir(): Promise<void> {
  await fsMkdir(STAGING_DIR, { recursive: true });
  try {
    const entries = await fsReadDir(STAGING_DIR);
    await Promise.all(
      entries
        .filter((f) => f.endsWith('.md'))
        .map((name) =>
          fsUnlink(join(STAGING_DIR, name)).catch((err: unknown) => {
            if (getNodeErrorCode(err) !== 'ENOENT') {
              throw err;
            }
          }),
        ),
    );
  } catch (error: unknown) {
    if (getNodeErrorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}
