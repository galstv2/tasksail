// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContextPackDeepFocusState } from '../../../src/shared/desktopContract';

const { readFileMock, writeTextFileAtomicMock, errorSpy, warnSpy } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeTextFileAtomicMock: vi.fn(),
  errorSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}));

vi.mock('../../../../../backend/platform/core/io', () => ({
  writeTextFileAtomic: writeTextFileAtomicMock,
}));

vi.mock('../../../../../backend/platform/context-pack/focusedRepo', () => ({
  deriveWritableRootsFromFocusedSelection: () => ({
    writableRoots: [],
    readonlyContextRoots: [],
  }),
}));

vi.mock('../../paths', () => ({
  REPO_ROOT: '/repo',
}));

vi.mock('../../utils', () => ({
  stringOrNull: (value: unknown) => (typeof value === 'string' ? value : null),
}));

vi.mock('./shared', () => ({
  clonePrimaryFocusTarget: (target: unknown) => target,
  mirrorSinglePrimaryScopedFields: (
    _targets: unknown,
    selectedTestTarget: unknown,
    selectedSupportTargets: unknown,
  ) => ({ selectedTestTarget, selectedSupportTargets }),
  toWorkspaceSyncPrimaryTarget: (target: unknown) => target,
}));

vi.mock('../../log/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: warnSpy,
    error: errorSpy,
    child: vi.fn(),
  }),
}));

const CONTEXT_PACK_DIR = '/contextpacks/orders';

function enoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error('no such file or directory'), { code: 'ENOENT' });
}

function sampleSelections(): ContextPackDeepFocusState {
  return {
    deepFocusEnabled: false,
    deepFocusPrimaryRepoId: null,
    deepFocusPrimaryFocusId: null,
    selectedFocusPath: null,
    selectedFocusTargetKind: null,
    selectedFocusTargets: [],
    selectedTestTarget: null,
    selectedSupportTargets: [],
  } as unknown as ContextPackDeepFocusState;
}

describe('deepFocusSelections persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    readFileMock.mockReset();
    writeTextFileAtomicMock.mockReset();
    errorSpy.mockReset();
    warnSpy.mockReset();
    writeTextFileAtomicMock.mockResolvedValue(undefined);
  });

  it('treats a missing selections file as an empty set without logging an error', async () => {
    readFileMock.mockRejectedValue(enoentError());
    const { loadDeepFocusSelections } = await import('./deepFocusSelections');

    const result = await loadDeepFocusSelections({ contextPackDir: CONTEXT_PACK_DIR });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toMatchObject({
        action: 'deepFocus.loadSelections',
        selections: null,
      });
    }
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('surfaces a corrupt selections file as a failure and logs a parse error', async () => {
    readFileMock.mockResolvedValue('{ this is not valid json');
    const { loadDeepFocusSelections } = await import('./deepFocusSelections');

    const result = await loadDeepFocusSelections({ contextPackDir: CONTEXT_PACK_DIR });

    expect(result.ok).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      'deep-focus.selections.parse.failed',
      expect.any(Error),
      expect.objectContaining({ path: expect.stringContaining('deep-focus-selections.json') }),
    );
  });

  it('refuses to overwrite a corrupt selections file, preserving other packs’ state', async () => {
    readFileMock.mockResolvedValue('{ corrupt');
    const { saveDeepFocusSelections } = await import('./deepFocusSelections');

    const result = await saveDeepFocusSelections({
      contextPackDir: CONTEXT_PACK_DIR,
      selections: sampleSelections(),
    });

    expect(result.ok).toBe(false);
    expect(writeTextFileAtomicMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'deep-focus.selections.parse.failed',
      expect.any(Error),
      expect.objectContaining({ path: expect.stringContaining('deep-focus-selections.json') }),
    );
  });

  it('still persists selections when the file is absent (fresh start)', async () => {
    readFileMock.mockRejectedValue(enoentError());
    const { saveDeepFocusSelections } = await import('./deepFocusSelections');

    const result = await saveDeepFocusSelections({
      contextPackDir: CONTEXT_PACK_DIR,
      selections: sampleSelections(),
    });

    expect(result.ok).toBe(true);
    expect(writeTextFileAtomicMock).toHaveBeenCalledWith(
      expect.stringContaining('deep-focus-selections.json'),
      expect.any(String),
    );
  });
});
