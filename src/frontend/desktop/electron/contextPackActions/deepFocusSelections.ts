import { readFile as fsReadFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type {
  ContextPackDeepFocusState,
  DesktopInvokeResult,
} from '../../src/shared/desktopContract';
import { writeTextFileAtomic } from '../../../../backend/platform/core/io';
import { deriveWritableRootsFromFocusedSelection } from '../../../../backend/platform/context-pack/focusedRepo';
import { REPO_ROOT } from '../paths';
import { stringOrNull } from '../utils';
import {
  clonePrimaryFocusTarget,
  mirrorSinglePrimaryScopedFields,
  toWorkspaceSyncPrimaryTarget,
} from './shared';
import { createLogger } from '../log/logger';

const log = createLogger('electron/contextPackActions/deepFocusSelections');

const DEEP_FOCUS_SELECTIONS_PATH = join(
  REPO_ROOT,
  '.platform-state/deep-focus-selections.json',
);
const WORKSPACE_CONTEXT_SYNC_PATH = join(
  REPO_ROOT,
  '.platform-state/workspace-context-sync.json',
);

type PersistedSelections = Record<string, ContextPackDeepFocusState>;

async function readSelectionsFile(): Promise<PersistedSelections> {
  let raw: string;
  try {
    raw = await fsReadFile(DEEP_FOCUS_SELECTIONS_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    log.error(
      'deep-focus.selections.read.failed',
      err instanceof Error ? err : { reason: String(err) },
      { path: DEEP_FOCUS_SELECTIONS_PATH },
    );
    throw err;
  }
  try {
    return JSON.parse(raw) as PersistedSelections;
  } catch (err: unknown) {
    log.error(
      'deep-focus.selections.parse.failed',
      err instanceof Error ? err : { reason: String(err) },
      { path: DEEP_FOCUS_SELECTIONS_PATH },
    );
    throw err;
  }
}

async function writeSelectionsFile(selections: PersistedSelections): Promise<void> {
  await writeJsonAtomic(DEEP_FOCUS_SELECTIONS_PATH, selections);
}

function withDerivedDeepFocusRoots(
  selections: ContextPackDeepFocusState,
): ContextPackDeepFocusState {
  const derived = deriveWritableRootsFromFocusedSelection({
    primaryFocusRelativePath: selections.selectedFocusPath ?? '',
    primaryFocusTargetKind: selections.selectedFocusTargetKind ?? undefined,
    primaryFocusTargets: selections.selectedFocusTargets,
    testTarget: selections.selectedTestTarget ?? undefined,
    supportTargets: selections.selectedSupportTargets.map((target) => ({
      ...target,
      effectiveScope: target.kind === 'directory' ? 'full-directory' as const : 'exact-file' as const,
    })),
  });
  return {
    ...selections,
    derivedWritableRoots: derived.writableRoots,
    derivedReadonlyContextRoots: derived.readonlyContextRoots,
  };
}

async function writeJsonAtomic(filePath: string, payload: unknown): Promise<void> {
  await writeTextFileAtomic(filePath, JSON.stringify(payload, null, 2) + '\n');
}

async function mirrorDeepFocusSelectionIntoWorkspaceSync(
  contextPackDir: string,
  selections: ContextPackDeepFocusState,
): Promise<void> {
  let raw: string;
  try {
    raw = await fsReadFile(WORKSPACE_CONTEXT_SYNC_PATH, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return;
    }
    throw err;
  }

  const state = JSON.parse(raw) as Record<string, unknown>;
  const activeContextPackDir = stringOrNull(state.active_context_pack_dir);
  if (!activeContextPackDir || resolve(activeContextPackDir) !== resolve(contextPackDir)) {
    return;
  }

  const before = JSON.stringify(state);
  state.deep_focus_enabled = selections.deepFocusEnabled;
  state.deep_focus_primary_repo_id = selections.deepFocusPrimaryRepoId;
  state.deep_focus_primary_focus_id = selections.deepFocusPrimaryFocusId;
  state.selected_focus_path = selections.selectedFocusPath;
  state.selected_focus_target_kind = selections.selectedFocusTargetKind;
  state.selected_focus_targets = (selections.selectedFocusTargets ?? []).map(toWorkspaceSyncPrimaryTarget);
  if (selections.selectedTestTarget === undefined) {
    delete state.selected_test_target;
  } else {
    state.selected_test_target = selections.selectedTestTarget;
  }
  state.selected_support_targets = selections.selectedSupportTargets;
  state.derived_writable_roots = selections.derivedWritableRoots ?? [];
  state.derived_readonly_context_roots = selections.derivedReadonlyContextRoots ?? [];

  if (JSON.stringify(state) === before) {
    return;
  }
  await writeJsonAtomic(WORKSPACE_CONTEXT_SYNC_PATH, state);
}

export async function saveDeepFocusSelections(
  payload: { contextPackDir: string; selections: ContextPackDeepFocusState },
): Promise<DesktopInvokeResult> {
  try {
    const selectedFocusTargets = (payload.selections.selectedFocusTargets ?? []).map(clonePrimaryFocusTarget);
    const mirrored = mirrorSinglePrimaryScopedFields(
      selectedFocusTargets,
      payload.selections.selectedTestTarget,
      payload.selections.selectedSupportTargets,
    );
    const selections = withDerivedDeepFocusRoots({
      ...payload.selections,
      selectedFocusTargets,
      selectedTestTarget: mirrored.selectedTestTarget,
      selectedSupportTargets: mirrored.selectedSupportTargets,
    });
    const all = await readSelectionsFile();
    all[payload.contextPackDir] = selections;
    await writeSelectionsFile(all);
    await mirrorDeepFocusSelectionIntoWorkspaceSync(payload.contextPackDir, selections);
    return {
      ok: true,
      response: {
        action: 'deepFocus.saveSelections' as const,
        mode: 'saved' as const,
        message: 'Deep focus selections saved.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.saveSelections',
      error: err instanceof Error ? err.message : 'Failed to save deep focus selections.',
    };
  }
}

export async function loadDeepFocusSelections(
  payload: { contextPackDir: string },
): Promise<DesktopInvokeResult> {
  try {
    const all = await readSelectionsFile();
    const selections = all[payload.contextPackDir] ?? null;
    return {
      ok: true,
      response: {
        action: 'deepFocus.loadSelections' as const,
        mode: 'read-only' as const,
        message: selections ? 'Deep focus selections loaded.' : 'No saved selections found.',
        selections,
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.loadSelections',
      error: err instanceof Error ? err.message : 'Failed to load deep focus selections.',
    };
  }
}

export async function clearDeepFocusSelections(
  payload: { contextPackDir: string },
): Promise<DesktopInvokeResult> {
  try {
    const all = await readSelectionsFile();
    delete all[payload.contextPackDir];
    await writeSelectionsFile(all);
    return {
      ok: true,
      response: {
        action: 'deepFocus.clearSelections' as const,
        mode: 'cleared' as const,
        message: 'Deep focus selections cleared.',
      },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      action: 'deepFocus.clearSelections',
      error: err instanceof Error ? err.message : 'Failed to clear deep focus selections.',
    };
  }
}
