import { readFile as fsReadFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

import { writeTextFileAtomic } from '../../../../backend/platform/core/io';
import type {
  ContextPackFocusFilter,
  ContextPackFocusFilterSelection,
  DesktopInvokeResult,
} from '../../src/shared/desktopContract';
import {
  hasSaveableSelection,
  selectionFingerprint,
} from '../../src/shared/contextPackFocusFilterUtils';
import { REPO_ROOT } from '../paths';
import { createLogger } from '../log/logger';

const log = createLogger('electron/contextPackActions/focusFilters');

export const FOCUS_FILTERS_PATH = join(
  REPO_ROOT,
  '.platform-state/context-pack-focus-filters.json',
);

type PersistedFocusFilters = Record<string, ContextPackFocusFilter[]>;

function validateContextPackDir(contextPackDir: string): void {
  if (!contextPackDir || !isAbsolute(contextPackDir)) {
    throw new Error('contextPackDir must be a non-empty absolute path.');
  }
}

function validateRepositoryTypes(selection: ContextPackFocusFilterSelection): void {
  for (const [repoId, repositoryType] of Object.entries(selection.repositoryTypes ?? {})) {
    if (!repoId.trim()) {
      throw new Error('Focus filter repository type keys must be non-empty strings.');
    }
    if (repositoryType !== 'primary' && repositoryType !== 'support') {
      throw new Error(`Focus filter repository type for "${repoId}" must be primary or support.`);
    }
  }
}

async function readFiltersFile(): Promise<PersistedFocusFilters> {
  let raw: string;
  try {
    raw = await fsReadFile(FOCUS_FILTERS_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    log.error('focus-filters.read.failed', err instanceof Error ? err : { reason: String(err) }, {
      path: FOCUS_FILTERS_PATH,
    });
    throw err;
  }
  try {
    return JSON.parse(raw) as PersistedFocusFilters;
  } catch (err: unknown) {
    log.error('focus-filters.parse.failed', err instanceof Error ? err : { reason: String(err) }, {
      path: FOCUS_FILTERS_PATH,
    });
    throw err;
  }
}

async function writeFiltersFile(filters: PersistedFocusFilters): Promise<void> {
  await writeTextFileAtomic(FOCUS_FILTERS_PATH, `${JSON.stringify(filters, null, 2)}\n`);
}

export async function removeFocusFiltersForContextPack(contextPackDir: string): Promise<void> {
  const all = await readFiltersFile();
  if (!(contextPackDir in all)) {
    return;
  }
  delete all[contextPackDir];
  await writeFiltersFile(all);
}

export async function listFocusFilters(
  payload: { contextPackDir: string },
): Promise<DesktopInvokeResult> {
  try {
    validateContextPackDir(payload.contextPackDir);
    const all = await readFiltersFile();
    const filters = all[payload.contextPackDir] ?? [];
    return {
      ok: true,
      response: {
        action: 'focusFilters.list' as const,
        mode: 'read-only' as const,
        filters,
        message: filters.length ? `${filters.length} focus filter(s).` : 'No focus filters saved.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'focusFilters.list',
      error: err instanceof Error ? err.message : 'Failed to list focus filters.',
    };
  }
}

export async function createFocusFilter(
  payload: {
    contextPackDir: string;
    name: string;
    selection: ContextPackFocusFilterSelection;
  },
): Promise<DesktopInvokeResult> {
  try {
    validateContextPackDir(payload.contextPackDir);
    const name = payload.name.trim();
    if (name.length < 1 || name.length > 48) {
      throw new Error('Focus filter name must be 1-48 characters.');
    }
    validateRepositoryTypes(payload.selection);
    if (!hasSaveableSelection(payload.selection)) {
      throw new Error('Focus filter selection must include at least one selected scope.');
    }
    const all = await readFiltersFile();
    const existing = all[payload.contextPackDir] ?? [];
    if (existing.some((filter) => filter.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new Error(`A focus filter named "${name}" already exists for this context pack.`);
    }
    const fingerprint = selectionFingerprint(payload.selection);
    if (existing.some((filter) => selectionFingerprint(filter.selection) === fingerprint)) {
      throw new Error('A focus filter with the same selection already exists for this context pack.');
    }
    const now = new Date().toISOString();
    const filter: ContextPackFocusFilter = {
      id: randomUUID(),
      name,
      contextPackDir: payload.contextPackDir,
      createdAt: now,
      updatedAt: now,
      selection: payload.selection,
    };
    const filters = [...existing, filter];
    all[payload.contextPackDir] = filters;
    await writeFiltersFile(all);
    return {
      ok: true,
      response: {
        action: 'focusFilters.create' as const,
        mode: 'created' as const,
        filter,
        filters,
        message: `Focus filter "${name}" saved.`,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'focusFilters.create',
      error: err instanceof Error ? err.message : 'Failed to create focus filter.',
    };
  }
}

export async function deleteFocusFilter(
  payload: { contextPackDir: string; filterId: string },
): Promise<DesktopInvokeResult> {
  try {
    validateContextPackDir(payload.contextPackDir);
    if (!payload.filterId.trim()) {
      throw new Error('filterId must be a non-empty string.');
    }
    const all = await readFiltersFile();
    const current = all[payload.contextPackDir] ?? [];
    const filters = current.filter((filter) => filter.id !== payload.filterId);
    all[payload.contextPackDir] = filters;
    await writeFiltersFile(all);
    return {
      ok: true,
      response: {
        action: 'focusFilters.delete' as const,
        mode: 'deleted' as const,
        filters,
        message: 'Focus filter deleted.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'focusFilters.delete',
      error: err instanceof Error ? err.message : 'Failed to delete focus filter.',
    };
  }
}
