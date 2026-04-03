import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopShellClient } from '../services/desktopShellClient';

import { useRealignmentDocument } from './useRealignmentDocument';

function mockClient(overrides: Partial<DesktopShellClient> = {}): DesktopShellClient {
  return {
    readRealignmentDoc: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.readRealignmentDoc',
        mode: 'read-only',
        message: 'Version 3.',
        document: {
          standingExpectations: ['Be precise'],
          behavioralGuidance: ['No guessing'],
          lessonsLearned: [],
          fairnessFraming: ['Equal treatment'],
          version: 3,
          updatedAt: '2026-03-22T10:00:00Z',
        },
      },
    }),
    updateRealignmentDoc: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'reinforcement.updateRealignmentDoc',
        mode: 'updated',
        passed: true,
        message: 'Global realignment document updated.',
      },
    }),
    ...overrides,
  } as unknown as DesktopShellClient;
}

describe('useRealignmentDocument', () => {
  let client: DesktopShellClient;

  beforeEach(() => {
    client = mockClient();
  });

  it('loads document on mount when context pack is active', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.draft.standingExpectations).toBe('Be precise');
    expect(result.current.draft.behavioralGuidance).toBe('No guessing');
    expect(result.current.draft.fairnessFraming).toBe('Equal treatment');
    expect(result.current.version).toBe(3);
    expect(result.current.updatedAt).toBe('2026-03-22T10:00:00Z');
  });

  it('does not load when no context pack is active', async () => {
    const { result } = renderHook(() => useRealignmentDocument(false, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(client.readRealignmentDoc).not.toHaveBeenCalled();
    expect(result.current.version).toBe(0);
  });

  it('tracks dirty state on field changes', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.onFieldChange('standingExpectations', 'Updated value');
    });

    expect(result.current.dirty).toBe(true);
    expect(result.current.draft.standingExpectations).toBe('Updated value');
  });

  it('discards changes and resets to baseline', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('standingExpectations', 'Changed');
    });
    expect(result.current.dirty).toBe(true);

    act(() => {
      result.current.onDiscard();
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft.standingExpectations).toBe('Be precise');
  });

  it('saves via client and reloads', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('lessonsLearned', 'New lesson');
    });

    await act(async () => {
      await result.current.onSave('/tmp/context-packs/test');
    });

    expect(client.updateRealignmentDoc).toHaveBeenCalledWith({
      contextPackDir: '/tmp/context-packs/test',
      updates: {
        expected_version: 3,
        standingExpectations: ['Be precise'],
        behavioralGuidance: ['No guessing'],
        lessonsLearned: ['New lesson'],
        fairnessFraming: ['Equal treatment'],
      },
    });

    expect(result.current.saveState.status).toBe('saved');
    // Reload was triggered (readRealignmentDoc called twice: initial + post-save)
    expect(client.readRealignmentDoc).toHaveBeenCalledTimes(2);
  });

  it('sets error state on save failure', async () => {
    client = mockClient({
      updateRealignmentDoc: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Permission denied.',
      }),
    });

    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('standingExpectations', 'New');
    });

    await act(async () => {
      await result.current.onSave('/tmp/context-packs/test');
    });

    expect(result.current.saveState).toEqual({
      status: 'error',
      message: 'Permission denied.',
    });
  });

  it('sets load error on fetch failure', async () => {
    client = mockClient({
      readRealignmentDoc: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Network error.',
      }),
    });

    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.loadError).toBe('Network error.');
  });

  it('splits multi-line text into array items on save', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('lessonsLearned', 'Line one\n\nLine two\n  Line three  ');
    });

    await act(async () => {
      await result.current.onSave('/tmp/test');
    });

    const call = (client.updateRealignmentDoc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.updates.lessonsLearned).toEqual(['Line one', 'Line two', 'Line three']);
  });

  it('sends expected_version with save payload', async () => {
    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('standingExpectations', 'Changed');
    });

    await act(async () => {
      await result.current.onSave('/tmp/test');
    });

    const call = (client.updateRealignmentDoc as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.updates.expected_version).toBe(3);
  });

  it('detects version conflict and sets conflict state', async () => {
    client = mockClient({
      updateRealignmentDoc: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Version conflict: expected 3, but document is at version 5.',
        errorCode: 'version_conflict',
      }),
    });

    const { result } = renderHook(() => useRealignmentDocument(true, client));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.onFieldChange('standingExpectations', 'Changed');
    });

    await act(async () => {
      await result.current.onSave('/tmp/test');
    });

    expect(result.current.saveState.status).toBe('conflict');
  });
});
