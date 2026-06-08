// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../../contexts/ObservabilityContext';
import { ToastProvider } from '../../contexts/ToastContext';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import type { PlannerStartSessionDeepFocusSelection } from '../../../shared/desktopContract';
import {
  createMockClient,
  createPlannerSubmitResponse,
} from '../../../test';
import { usePlannerModal } from './usePlannerModal';

afterEach(() => {
  cleanup();
});

function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    submitPlannerDraft: vi.fn().mockResolvedValue({
      ok: true,
      response: createPlannerSubmitResponse({
        message: 'Draft accepted.',
        draftTitle: 'Test',
      }),
    }),
    ...overrides,
  });
}

function makeWrapper(client: DesktopShellClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <ObservabilityProvider client={client}>{children}</ObservabilityProvider>
      </ToastProvider>
    );
  };
}

function renderPlannerModalHook(
  client?: DesktopShellClient,
  options?: {
    hasActiveContextPack?: boolean;
    activeContextPackDir?: string | null;
    deepFocusSelection?: PlannerStartSessionDeepFocusSelection;
  },
) {
  const c = client ?? createClient();
  const hasActive = options?.hasActiveContextPack ?? true;
  const activeDir = options && 'activeContextPackDir' in options
    ? options.activeContextPackDir ?? null
    : hasActive ? '/tmp/test-context-pack' : null;
  return renderHook(
    () => {
      const [contractError, setContractError] = useState('');
      return usePlannerModal(
        c,
        'idle',
        hasActive,
        contractError,
        setContractError,
        activeDir,
        options?.deepFocusSelection,
      );
    },
    { wrapper: makeWrapper(c) },
  );
}

describe('usePlannerModal — markdown file attach', () => {
  it('pickMarkdownFile sets selectedMarkdownFile on successful selection', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec\n\nContent here.',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toEqual({
      filename: 'spec.md',
      path: '/home/user/spec.md',
      content: '# Spec\n\nContent here.',
    });
  });

  it('pickMarkdownFile does not set error on cancelled selection', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'cancelled',
          message: 'Markdown file selection was cancelled.',
          filename: null,
          path: null,
          content: null,
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
    expect(result.current.plannerModalProps.draftError).toBeFalsy();
  });

  it('pickMarkdownFile sets draftError on failure', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: false,
        action: 'planner.pickMarkdownFile',
        error: 'Selected file exceeds the 128 KB size limit (256 KB).',
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
    expect(result.current.plannerModalProps.draftError).toBe('Selected file exceeds the 128 KB size limit (256 KB).');
  });

  it('clearSelectedFile resets selectedMarkdownFile', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    act(() => {
      result.current.plannerModalProps.onClearSelectedFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
  });

  it('closing modal clears selectedMarkdownFile', async () => {
    const client = createClient({
      pickMarkdownFile: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          action: 'planner.pickMarkdownFile',
          mode: 'selected',
          message: 'Markdown file selected: spec.md',
          filename: 'spec.md',
          path: '/home/user/spec.md',
          content: '# Spec',
        },
      }),
    });
    const { result } = renderPlannerModalHook(client);

    act(() => {
      result.current.openPlannerModal();
    });

    await act(async () => {
      result.current.plannerModalProps.onPickMarkdownFile!();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).not.toBeNull();

    act(() => {
      result.current.plannerModalProps.onClose();
    });

    expect(result.current.plannerModalProps.selectedMarkdownFile).toBeNull();
  });
});
