import { useCallback, useMemo, useRef, useState } from 'react';

import type { ContextPackCreateExecutionResult } from '../../shared/desktopContract';
import { isCreateResponse } from '../../shared/desktopContractTypeGuards';
import type {
  ContextPackCreationDraft,
  ContextPackCreationModalProps,
  ContextPackCreationModalStep,
} from '../contextPackCreationTypes';
import { desktopShellClient, type DesktopShellClient } from '../services/desktopShellClient';
import { formatIpcError, normalizeIpcThrownError, withIpcTimeout, DEFAULT_IPC_TIMEOUT_MS } from '../services/ipcErrorHelpers';
import {
  INITIAL_DRAFT,
  buildValidationErrors,
  createInitialDistributedRepositories,
  normalizeDraftForMode,
  parseCsv,
  slugifyValue,
} from './useContextPackDraft';
import { useContextPackDraft } from './useContextPackDraft';
import { useContextPackDiscovery, type DiscoveryState } from './useContextPackDiscovery';

type ClosedModalState = {
  kind: 'closed';
};

type OpenModalState = {
  kind: 'open';
  step: ContextPackCreationModalStep;
  draft: ContextPackCreationDraft;
  discovery: DiscoveryState;
  error: string;
  message: string;
};

type SubmittingModalState = {
  kind: 'submitting';
  step: 'review';
  draft: ContextPackCreationDraft;
  discovery: DiscoveryState;
  error: string;
  message: string;
};

type ContextPackCreationState =
  | ClosedModalState
  | OpenModalState
  | SubmittingModalState;

export type UseContextPackCreationOptions = {
  onCreated: (
    createdContextPack: ContextPackCreateExecutionResult,
    message: string,
  ) => Promise<void> | void;
  defaultContextPackParentDir?: string;
};

export function useContextPackCreation(
  client: DesktopShellClient = desktopShellClient,
  options: UseContextPackCreationOptions,
): { contextPackCreationModalProps: ContextPackCreationModalProps } {
  const [state, setState] = useState<ContextPackCreationState>({ kind: 'closed' });
  const stateRef = useRef(state);
  stateRef.current = state;

  const openModal = useCallback(() => {
    setState({
      kind: 'open',
      step: 'setup',
      draft: {
        ...INITIAL_DRAFT,
        contextPackDir: options.defaultContextPackParentDir ?? '',
        repositories: createInitialDistributedRepositories(),
      },
      discovery: { status: 'idle' },
      error: '',
      message: 'Set the target path, discovery root, and estate mode before scanning.',
    });
  }, [options.defaultContextPackParentDir]);

  const closeModal = useCallback(() => {
    setState({ kind: 'closed' });
  }, []);

  const handleUpdateDraft = useCallback(
    (updater: (draft: ContextPackCreationDraft) => ContextPackCreationDraft) => {
      setState((current) => {
        if (current.kind === 'closed') {
          return current;
        }
        return { ...current, draft: updater(current.draft), error: '' };
      });
    },
    [],
  );

  const draftHandlers = useContextPackDraft(handleUpdateDraft);
  const { browsePath, discoverPrefill } = useContextPackDiscovery(
    client,
    () => stateRef.current as { kind: string; draft: ContextPackCreationDraft },
    draftHandlers.updateDraft,
    setState as (updater: (current: unknown) => unknown) => void,
  );

  const goNext = useCallback(() => {
    setState((current) => {
      if (current.kind !== 'open') {
        return current;
      }
      if (current.step === 'setup') {
        return { ...current, step: 'shape', error: '' };
      }
      if (current.step === 'shape') {
        return { ...current, step: 'review', error: '' };
      }
      return current;
    });
  }, []);

  const goBack = useCallback(() => {
    setState((current) => {
      if (current.kind !== 'open') {
        return current;
      }
      if (current.step === 'review') {
        return { ...current, step: 'shape', error: '' };
      }
      if (current.step === 'shape') {
        return { ...current, step: 'setup', error: '' };
      }
      return current;
    });
  }, []);

  const submitCreate = useCallback(async () => {
    if (state.kind === 'closed') {
      return;
    }
    const normalizedDraft = normalizeDraftForMode(state.draft);
    const validationErrors = buildValidationErrors(normalizedDraft);
    if (validationErrors.length > 0) {
      setState((current) =>
        current.kind === 'closed'
          ? current
          : {
              ...current,
              error: validationErrors[0],
              message: 'Review the estate definition before creating the pack.',
            },
      );
      return;
    }

    setState((current) =>
      current.kind === 'closed'
        ? current
        : {
            ...current,
            kind: 'submitting',
            step: 'review',
            error: '',
            message: 'Creating the context pack and waiting for backend validation…',
          },
    );

    const applyCreationError = (errorMsg: string): void => {
      setState((current) =>
        current.kind === 'closed'
          ? current
          : current.kind === 'submitting'
            ? {
                kind: 'open',
                step: 'review',
                draft: current.draft,
                discovery: current.discovery,
                error: errorMsg,
                message: 'Context-pack creation failed. Review the request and try again.',
              }
            : {
                ...current,
                error: errorMsg,
                message: 'Context-pack creation failed. Review the request and try again.',
              },
      );
    };

    try {
      const result = await withIpcTimeout(client.createContextPack({
        contextPackDir: normalizedDraft.contextPackDir,
        discoveryRoot: normalizedDraft.discoveryRoot,
        mode: normalizedDraft.mode,
        writePlan: true,
        seedOnCreate: true,
        bootstrapAnswers: {
          contextPackId: normalizedDraft.contextPackId,
          estateName: normalizedDraft.estateName,
          defaultScopeMode: normalizedDraft.defaultScopeMode,
          primaryWorkingRepoIds: normalizedDraft.repositories
            .filter((r) => r.primary)
            .map((r) => r.repoId || slugifyValue(r.repoName)),
          primaryFocusAreaIds: normalizedDraft.focusAreas
            .filter((f) => f.primary)
            .map((f) => f.focusId || slugifyValue(f.focusName)),
          repositories: normalizedDraft.repositories.map((r) => ({
            repoRoot: r.repoRoot,
            repoName: r.repoName,
            repoId: r.repoId || slugifyValue(r.repoName),
            owner: r.owner || undefined,
            systemLayer: r.systemLayer,
            languages: parseCsv(r.languages),
            artifactRoots: parseCsv(r.artifactRoots),
            documentPaths: parseCsv(r.documentPaths),
            boundedContext: r.boundedContext || undefined,
            serviceName: r.serviceName || undefined,
            repoRole: r.repoRole || undefined,
            workspaceActivationGroup: r.workspaceActivationGroup || undefined,
            defaultFocusable: r.defaultFocusable,
            activationPriority: r.activationPriority,
          })),
          focusableAreas:
            normalizedDraft.mode === 'monolith'
              ? normalizedDraft.focusAreas.map((f) => ({
                  focusId: f.focusId || undefined,
                  focusName: f.focusName || undefined,
                  relativePath: f.relativePath || undefined,
                  path: f.path || undefined,
                  focusType: f.focusType || undefined,
                  group: f.group || undefined,
                  defaultFocusable: f.defaultFocusable,
                  activationPriority: f.activationPriority,
                  repositoryType: f.repositoryType,
                }))
              : undefined,
        },
      }), DEFAULT_IPC_TIMEOUT_MS, 'context-pack creation');

      if (!result.ok || !isCreateResponse(result.response)) {
        applyCreationError(
          result.ok ? 'Creation returned an unexpected response.' : formatIpcError(result),
        );
        return;
      }

      await options.onCreated(result.response.result, result.response.message);
      setState({ kind: 'closed' });
    } catch (error: unknown) {
      applyCreationError(
        normalizeIpcThrownError(error, 'Context-pack creation failed unexpectedly.'),
      );
    }
  }, [client, options, state]);

  const modalProps = useMemo<Omit<ContextPackCreationModalProps, 'onOpen'>>(() => {
    if (state.kind === 'closed') {
      return {
        isOpen: false,
        busy: false,
        step: 'setup',
        draft: { ...INITIAL_DRAFT, repositories: [], focusAreas: [] },
        discoveryStatus: 'idle',
        discoverySummary: '',
        error: '',
        message: '',
        canGoBack: false,
        canGoNext: false,
        onClose: closeModal,
        onBrowseContextPackDir: () => Promise.resolve(),
        onBrowseDiscoveryRoot: () => Promise.resolve(),
        onChangeMode: () => undefined,
        onDraftFieldChange: () => undefined,
        onDiscoverPrefill: () => Promise.resolve(),
        onAddRepository: () => undefined,
        onRemoveRepository: () => undefined,
        onRepositoryFieldChange: () => undefined,
        onSetPrimaryRepository: () => undefined,
        onAddFocusArea: () => undefined,
        onRemoveFocusArea: () => undefined,
        onFocusAreaFieldChange: () => undefined,
        onSetPrimaryFocusArea: () => undefined,
        onBack: () => undefined,
        onNext: () => undefined,
        onCreate: () => Promise.resolve(),
      };
    }

    const discoverySummary =
      state.discovery.status === 'ready'
        ? state.discovery.response.estateType === 'distributed'
          ? `${state.discovery.response.candidateRepos.length} repo suggestion(s) discovered.`
          : `${state.discovery.response.candidateFocusAreas.length} focus area suggestion(s) discovered.`
        : state.discovery.status === 'error'
          ? state.discovery.error
          : state.discovery.status === 'loading'
            ? 'Scanning selected root…'
            : 'No discovery results loaded yet.';

    return {
      isOpen: true,
      busy: state.kind === 'submitting' || state.discovery.status === 'loading',
      step: state.step,
      draft: state.draft,
      discoveryStatus: state.discovery.status,
      discoverySummary,
      error: state.error,
      message: state.message,
      canGoBack: state.kind === 'open' && state.step !== 'setup',
      canGoNext: state.kind === 'open' && state.step !== 'review',
      onClose: closeModal,
      onBrowseContextPackDir: () => browsePath('context-pack-destination'),
      onBrowseDiscoveryRoot: () => browsePath('discovery-root'),
      onChangeMode: draftHandlers.setMode,
      onDraftFieldChange: draftHandlers.setDraftField,
      onDiscoverPrefill: discoverPrefill,
      onAddRepository: draftHandlers.addRepository,
      onRemoveRepository: draftHandlers.removeRepository,
      onRepositoryFieldChange: draftHandlers.updateRepository,
      onSetPrimaryRepository: draftHandlers.updateRepositoryPrimary,
      onAddFocusArea: draftHandlers.addFocusArea,
      onRemoveFocusArea: draftHandlers.removeFocusArea,
      onFocusAreaFieldChange: draftHandlers.updateFocusArea,
      onSetPrimaryFocusArea: draftHandlers.updateFocusAreaPrimary,
      onBack: goBack,
      onNext: goNext,
      onCreate: submitCreate,
    };
  }, [
    browsePath,
    closeModal,
    discoverPrefill,
    draftHandlers,
    goBack,
    goNext,
    state,
    submitCreate,
  ]);

  return {
    contextPackCreationModalProps: {
      ...modalProps,
      onOpen: openModal,
    },
  };
}
