import { readFile as fsReadFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { writeTextFileAtomic } from '../../../../backend/platform/core/io';
import type {
  ContextPackFocusFilterSelection,
  ContextPackSidebarPersistedState,
  DesktopInvokeResult,
} from '../../src/shared/desktopContract';
import { REPO_ROOT } from '../paths';
import { createLogger } from '../log/logger';

const log = createLogger('electron/contextPackActions/contextPackSidebarState');

export const CONTEXT_PACK_SIDEBAR_STATE_PATH = join(
  REPO_ROOT,
  '.platform-state/context-pack-sidebar-state.json',
);

async function readSidebarStateFile(): Promise<ContextPackSidebarPersistedState | null> {
  let raw: string;
  try {
    raw = await fsReadFile(CONTEXT_PACK_SIDEBAR_STATE_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    log.error('context-pack-sidebar-state.read.failed', err instanceof Error ? err : { reason: String(err) }, {
      path: CONTEXT_PACK_SIDEBAR_STATE_PATH,
    });
    throw err;
  }
  try {
    return JSON.parse(raw) as ContextPackSidebarPersistedState;
  } catch (err: unknown) {
    log.error('context-pack-sidebar-state.parse.failed', err instanceof Error ? err : { reason: String(err) }, {
      path: CONTEXT_PACK_SIDEBAR_STATE_PATH,
    });
    throw err;
  }
}

async function writeSidebarStateFile(state: ContextPackSidebarPersistedState): Promise<void> {
  await writeTextFileAtomic(CONTEXT_PACK_SIDEBAR_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export async function removeSidebarStateForContextPack(contextPackDir: string): Promise<void> {
  const state = await readSidebarStateFile();
  if (!state) {
    return;
  }
  const nextSelections = { ...state.selectionsByContextPackDir };
  delete nextSelections[contextPackDir];
  await writeSidebarStateFile({
    selectedContextPackDir: state.selectedContextPackDir === contextPackDir ? null : state.selectedContextPackDir,
    updatedAt: new Date().toISOString(),
    selectionsByContextPackDir: nextSelections,
  });
}

export async function loadContextPackSidebarState(): Promise<DesktopInvokeResult> {
  try {
    const state = await readSidebarStateFile();
    return {
      ok: true,
      response: {
        action: 'contextPackSidebarState.load' as const,
        mode: 'read-only' as const,
        state,
        message: state ? 'Context-pack sidebar state loaded.' : 'No context-pack sidebar state saved.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'contextPackSidebarState.load',
      error: err instanceof Error ? err.message : 'Failed to load context-pack sidebar state.',
    };
  }
}

export async function saveContextPackSidebarState(
  payload: {
    selectedContextPackDir: string | null;
    selection: ContextPackFocusFilterSelection | null;
  },
): Promise<DesktopInvokeResult> {
  try {
    if (payload.selection && (!payload.selectedContextPackDir || !isAbsolute(payload.selectedContextPackDir))) {
      throw new Error('selectedContextPackDir must be a non-empty absolute path when selection is present.');
    }
    if (payload.selectedContextPackDir !== null && !isAbsolute(payload.selectedContextPackDir)) {
      throw new Error('selectedContextPackDir must be null or an absolute path.');
    }
    const current = await readSidebarStateFile();
    const selectionsByContextPackDir = {
      ...(current?.selectionsByContextPackDir ?? {}),
    };
    if (payload.selectedContextPackDir && payload.selection) {
      selectionsByContextPackDir[payload.selectedContextPackDir] = payload.selection;
    }
    await writeSidebarStateFile({
      selectedContextPackDir: payload.selectedContextPackDir,
      updatedAt: new Date().toISOString(),
      selectionsByContextPackDir,
    });
    return {
      ok: true,
      response: {
        action: 'contextPackSidebarState.save' as const,
        mode: 'saved' as const,
        message: 'Context-pack sidebar state saved.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'contextPackSidebarState.save',
      error: err instanceof Error ? err.message : 'Failed to save context-pack sidebar state.',
    };
  }
}
