import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObservabilityProvider } from '../contexts/ObservabilityContext';
import { ToastProvider } from '../contexts/ToastContext';
import type { DesktopShellClient } from '../services/desktopShellClient';
import {
  createMockClient,
  createCreateContextPackResponse,
} from '../../test';
import {
  useContextPackCreation,
  type UseContextPackCreationOptions,
} from './useContextPackCreation';
import { CONTEXT_PACK_CREATION_DRAFT_KEY } from './useContextPackCreationDraftPersistence';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function createClient(overrides?: Partial<DesktopShellClient>): DesktopShellClient {
  return createMockClient({
    createContextPack: vi.fn().mockResolvedValue({
      ok: true,
      response: createCreateContextPackResponse({
        message: 'Context pack created.',
      }),
    }),
    pickContextPackDirectory: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'contextPack.pickDirectory',
        mode: 'selected',
        message: 'Directory selected.',
        selectedPath: '/tmp/packs/test-pack',
      },
    }),
    discoverContextPackPrefill: vi.fn().mockResolvedValue({
      ok: true,
      response: {
        action: 'contextPack.discoverPrefill',
        mode: 'discovered',
        message: 'Discovery complete.',
        rootPath: '/tmp/root',
        discoveryMode: 'auto',
        estateType: 'distributed',
        suggestedContextPackId: 'test-pack',
        suggestedDisplayName: 'Test Pack',
        warnings: [],
        candidateRepos: [
          {
            repoId: 'repo-1',
            repoName: 'Repo One',
            path: '/tmp/root/repo-1',
            relativePath: 'repo-1',
            highSignalPaths: ['src/'],
          },
        ],
        candidateFocusAreas: [],
        highSignalPaths: [],
      },
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

function renderCreationHook(
  client: DesktopShellClient,
  options?: Partial<UseContextPackCreationOptions>,
) {
  const onCreated = options?.onCreated ?? vi.fn();
  return renderHook(
    () =>
      useContextPackCreation(client, {
        onCreated,
        defaultContextPackParentDir: options?.defaultContextPackParentDir,
      }),
    { wrapper: makeWrapper(client) },
  );
}

describe('useContextPackCreation', () => {
  it('starts with modal closed', () => {
    const { result } = renderCreationHook(createClient());
    expect(result.current.contextPackCreationModalProps.isOpen).toBe(false);
    expect(result.current.contextPackCreationModalProps.step).toBe('setup');
  });

  it('opens modal to setup step with initial draft', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);
    expect(result.current.contextPackCreationModalProps.step).toBe('setup');
    expect(result.current.contextPackCreationModalProps.draft.mode).toBe('distributed');
    expect(result.current.contextPackCreationModalProps.draft.repositories).toHaveLength(1);
  });

  it('uses defaultContextPackParentDir when opening', () => {
    const { result } = renderCreationHook(createClient(), {
      defaultContextPackParentDir: '/custom/path',
    });

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.draft.contextPackDir).toBe('/custom/path');
  });

  it('persists draft state across close and reopen', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });
    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Persisted Estate');
      result.current.contextPackCreationModalProps.onDraftFieldChange('creationOrigin', 'new');
    });
    act(() => {
      result.current.contextPackCreationModalProps.onWizardStepChange?.('project-name');
    });

    act(() => {
      result.current.contextPackCreationModalProps.onClose();
    });
    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);
    expect(result.current.contextPackCreationModalProps.draft.estateName).toBe('Persisted Estate');
    expect(result.current.contextPackCreationModalProps.draft.creationOrigin).toBe('new');
    expect(result.current.contextPackCreationModalProps.wizardStep).toBe('project-name');
  });

  it('hydrates persisted v1 draft repositories without category fields', () => {
    window.localStorage.setItem(CONTEXT_PACK_CREATION_DRAFT_KEY, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      draft: {
        contextPackDir: '/tmp/pack',
        discoveryRoot: '/tmp/root',
        mode: 'distributed',
        contextPackId: 'persisted-pack',
        estateName: 'Persisted Pack',
        defaultScopeMode: 'focused',
        creationOrigin: 'existing',
        repositories: [
          {
            key: 'repo-1',
            repoRoot: '/tmp/root/repo-1',
            repoName: 'Repo One',
            repoId: 'repo-1',
            owner: '',
            systemLayer: 'backend',
            languages: '',
            artifactRoots: '',
            documentPaths: '',
            boundedContext: '',
            serviceName: '',
            repoRole: '',
            workspaceActivationGroup: '',
            defaultFocusable: true,
            activationPriority: 100,
            primary: true,
            repositoryType: 'primary',
          },
        ],
        focusAreas: [],
      },
      modalStep: 'shape',
      wizardStep: null,
      wizardParts: [],
      creationOrigin: 'existing',
    }));

    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.draft.repositories[0]).toEqual(
      expect.objectContaining({
        repoCategory: 'unknown',
        repoCategoryAuthored: false,
      }),
    );
    expect(result.current.contextPackCreationModalProps.draft.repositories[0].repoCategoryConfidence).toBeUndefined();
  });

  it('prefills from repo intent when no persisted draft exists', async () => {
    const client = createClient();
    const { result } = renderCreationHook(client);

    act(() => {
      result.current.contextPackCreationModalProps.onOpen({
        kind: 'prefill-from-repo',
        repoRoot: '/tmp/current-repo',
      });
    });

    expect(result.current.contextPackCreationModalProps.draft.discoveryRoot).toBe('/tmp/current-repo');
    await waitFor(() => {
      expect(client.discoverContextPackPrefill).toHaveBeenCalled();
    });
  });

  it('navigates forward through steps: setup → shape → review', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(true);
    expect(result.current.contextPackCreationModalProps.canGoBack).toBe(false);

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');
    expect(result.current.contextPackCreationModalProps.canGoBack).toBe(true);

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('review');
    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(false);
  });

  it('navigates backward: review → shape → setup', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('review');

    act(() => {
      result.current.contextPackCreationModalProps.onBack();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');

    act(() => {
      result.current.contextPackCreationModalProps.onBack();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('setup');
  });

  it('blocks distributed shape advancement until a primary repository is selected', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onChangeMode('distributed-platform');
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
    expect(repoKey).toBeTruthy();

    act(() => {
      result.current.contextPackCreationModalProps.onSetPrimaryRepository(repoKey!);
    });

    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(false);
    expect(result.current.contextPackCreationModalProps.canGoNextReason).toBe(
      'Mark at least one repository as primary to continue.',
    );

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');

    act(() => {
      result.current.contextPackCreationModalProps.onSetPrimaryRepository(repoKey!);
    });

    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(true);
  });

  it('blocks monolith shape advancement until a focus area exists', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onChangeMode('monolith-platform');
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');
    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(false);
    expect(result.current.contextPackCreationModalProps.canGoNextReason).toBe(
      'Add at least one focus area to continue.',
    );

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');

    act(() => {
      result.current.contextPackCreationModalProps.onAddFocusArea();
    });

    expect(result.current.contextPackCreationModalProps.canGoNext).toBe(true);
  });

  it('close resets to closed state', () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);

    act(() => {
      result.current.contextPackCreationModalProps.onClose();
    });

    expect(result.current.contextPackCreationModalProps.isOpen).toBe(false);
  });

  it('shows validation error when submitting with empty required fields', async () => {
    const { result } = renderCreationHook(createClient());

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    expect(result.current.contextPackCreationModalProps.error).toBeTruthy();
    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);
  });

  it('calls client.createContextPack and onCreated on successful submission', async () => {
    const onCreated = vi.fn();
    const client = createClient();
    const { result } = renderCreationHook(client, { onCreated });

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    // Fill required fields
    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('contextPackDir', '/tmp/pack');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/tmp/root');
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Test Estate');
    });

    // Also need repoRoot and repoName on the first repository
    act(() => {
      const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
      if (repoKey) {
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoRoot', '/tmp/repo');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoName', 'Test Repo');
      }
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    await waitFor(() => {
      expect(client.createContextPack).toHaveBeenCalled();
    });
    expect(onCreated).toHaveBeenCalled();
    expect(result.current.contextPackCreationModalProps.isOpen).toBe(false);
  });

  it('serializes repo category fields without standalone repo focus fields', async () => {
    const client = createClient();
    const { result } = renderCreationHook(client);

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('contextPackDir', '/tmp/pack');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/tmp/root');
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Test Estate');
    });

    act(() => {
      const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
      if (repoKey) {
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoRoot', '/tmp/repo');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoName', 'Test Repo');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoCategory', 'tool');
      }
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    const createCall = vi.mocked(client.createContextPack).mock.calls[0]?.[0];
    const repository = createCall?.bootstrapAnswers.repositories[0];

    expect(repository).toEqual(expect.objectContaining({
      repositoryType: 'primary',
      repoCategory: 'tool',
      repoCategoryAuthored: true,
    }));
    expect(repository).not.toHaveProperty('repoFocus');
    expect(repository).not.toHaveProperty('repoFocusAuthored');
  });

  it('derives stable new-project metadata and materializes wizard parts on setup → shape', async () => {
    const { result } = renderCreationHook(createClient(), {
      defaultContextPackParentDir: '/packs',
    });

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('creationOrigin', 'new');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/workspace/orders-platform');
    });

    expect(result.current.contextPackCreationModalProps.draft.estateName).toBe('Orders Platform');
    expect(result.current.contextPackCreationModalProps.draft.contextPackId).toBe('orders-platform');
    expect(result.current.contextPackCreationModalProps.draft.contextPackDir).toBe(
      `/packs/${result.current.contextPackCreationModalProps.draft.contextPackId}`,
    );

    act(() => {
      result.current.contextPackCreationModalProps.onWizardStepChange?.('build-parts');
    });

    await waitFor(() => {
      expect(result.current.contextPackCreationModalProps.wizardParts).toHaveLength(1);
    });

    const firstPartKey = result.current.contextPackCreationModalProps.wizardParts?.[0]?.key;
    expect(firstPartKey).toBeTruthy();

    act(() => {
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'role', 'backend');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'language', 'python');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'primary', true);
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(
        firstPartKey!,
        'location',
        '/workspace/orders-platform/orders-api',
      );
      result.current.contextPackCreationModalProps.onWizardAddPart?.();
    });

    const secondPartKey = result.current.contextPackCreationModalProps.wizardParts?.[1]?.key;
    expect(secondPartKey).toBeTruthy();

    act(() => {
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(secondPartKey!, 'name', 'orders-platform');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(secondPartKey!, 'role', 'frontend');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(secondPartKey!, 'language', 'typescript');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(
        secondPartKey!,
        'location',
        '/workspace/orders-platform/orders-web',
      );
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('shape');
    expect(result.current.contextPackCreationModalProps.draft.repositories.map((repository) => repository.repoId)).toEqual([
      'orders-platform',
      'orders-platform-2',
    ]);

    act(() => {
      result.current.contextPackCreationModalProps.onBack();
    });

    expect(result.current.contextPackCreationModalProps.step).toBe('setup');
    expect(result.current.contextPackCreationModalProps.wizardStep).toBe('build-parts');
  });

  it('serializes monolith focus area repository types in the create payload', async () => {
    const client = createClient();
    const { result } = renderCreationHook(client);

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onChangeMode('monolith');
      result.current.contextPackCreationModalProps.onDraftFieldChange('contextPackDir', '/tmp/pack');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/tmp/root');
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Monolith Estate');
    });

    act(() => {
      const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
      if (repoKey) {
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoRoot', '/tmp/root');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoName', 'Monolith Root');
      }
      result.current.contextPackCreationModalProps.onAddFocusArea();
    });

    act(() => {
      const focusKey = result.current.contextPackCreationModalProps.draft.focusAreas[0]?.key;
      if (focusKey) {
        result.current.contextPackCreationModalProps.onFocusAreaFieldChange(focusKey, 'focusId', 'core');
        result.current.contextPackCreationModalProps.onFocusAreaFieldChange(focusKey, 'focusName', 'Core');
        result.current.contextPackCreationModalProps.onFocusAreaFieldChange(focusKey, 'relativePath', 'src/core');
      }
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    expect(client.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        bootstrapAnswers: expect.objectContaining({
          focusableAreas: [
            expect.objectContaining({
              focusId: 'core',
              repositoryType: 'primary',
            }),
          ],
        }),
      }),
    );
  });

  it('disables seeding for new-project create payloads', async () => {
    const client = createClient();
    const { result } = renderCreationHook(client, {
      defaultContextPackParentDir: '/packs',
    });

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('creationOrigin', 'new');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/workspace/orders-platform');
      result.current.contextPackCreationModalProps.onWizardStepChange?.('build-parts');
    });

    await waitFor(() => {
      expect(result.current.contextPackCreationModalProps.wizardParts).toHaveLength(1);
    });

    const firstPartKey = result.current.contextPackCreationModalProps.wizardParts?.[0]?.key;

    act(() => {
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'role', 'backend');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'language', 'python');
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(firstPartKey!, 'primary', true);
      result.current.contextPackCreationModalProps.onWizardUpdatePart?.(
        firstPartKey!,
        'location',
        '/workspace/orders-platform/orders-api',
      );
    });

    act(() => {
      result.current.contextPackCreationModalProps.onNext();
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    expect(client.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        seedOnCreate: false,
        bootstrapAnswers: expect.objectContaining({
          repositories: [
            expect.objectContaining({
              repoRoot: '/workspace/orders-platform/orders-api',
              languages: ['python'],
            }),
          ],
        }),
      }),
    );
  });

  it('recovers from IPC throw during submission', async () => {
    const client = createClient({
      createContextPack: vi.fn().mockRejectedValue(new Error('IPC timeout')),
    });
    const { result } = renderCreationHook(client);

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('contextPackDir', '/tmp/pack');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/tmp/root');
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Test Estate');
    });

    act(() => {
      const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
      if (repoKey) {
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoRoot', '/tmp/repo');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoName', 'Test Repo');
      }
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    await waitFor(() => {
      expect(result.current.contextPackCreationModalProps.error).toBe('IPC timeout');
    });
    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);
    expect(result.current.contextPackCreationModalProps.busy).toBe(false);
  });

  it('shows error and keeps modal open on submission failure', async () => {
    const client = createClient({
      createContextPack: vi.fn().mockResolvedValue({
        ok: false,
        error: 'Backend validation failed.',
      }),
    });
    const { result } = renderCreationHook(client);

    act(() => {
      result.current.contextPackCreationModalProps.onOpen();
    });

    act(() => {
      result.current.contextPackCreationModalProps.onDraftFieldChange('contextPackDir', '/tmp/pack');
      result.current.contextPackCreationModalProps.onDraftFieldChange('discoveryRoot', '/tmp/root');
      result.current.contextPackCreationModalProps.onDraftFieldChange('estateName', 'Test Estate');
    });

    act(() => {
      const repoKey = result.current.contextPackCreationModalProps.draft.repositories[0]?.key;
      if (repoKey) {
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoRoot', '/tmp/repo');
        result.current.contextPackCreationModalProps.onRepositoryFieldChange(repoKey, 'repoName', 'Test Repo');
      }
    });

    await act(async () => {
      await result.current.contextPackCreationModalProps.onCreate();
    });

    await waitFor(() => {
      expect(result.current.contextPackCreationModalProps.error).toBe('Backend validation failed.');
    });
    expect(result.current.contextPackCreationModalProps.isOpen).toBe(true);
  });
});
