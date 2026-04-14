import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type {
  ContextPackCatalogEntry,
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackListRepoTreeResponse,
  ContextPackRepoTreeEntry,
} from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import { formatNumber } from '../utils/formatNumber';
import { DeepFocusBreadcrumb, type BreadcrumbItem } from './DeepFocusBreadcrumb';
import { DeepFocusSelectionTray } from './DeepFocusSelectionTray';
import { DeepFocusTreeRow, type TreeRowData, type FocusRole } from './DeepFocusTreeRow';
import {
  basename,
  buildSupportDisplayLabels,
  formatRelativeTime,
  getPrimaryDisplayLabel,
  inferDraftPrimaryTarget,
  joinRelativePath,
  normalizeRelativePath,
  removePathPrefix,
  isSameTarget,
} from './SidebarDeepFocusUtils';

export type DeepFocusCommit = {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

type SidebarDeepFocusControlsProps = {
  selectedPack: ContextPackCatalogEntry;
  selectedWorkingFocusIds: string[];
  deepFocusEnabled: boolean;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  onCommitDeepFocusSelection: (selection: DeepFocusCommit) => void;
  onListRepoTree: (
    repoLocalPath: string,
    relativePath?: string,
  ) => Promise<ContextPackListRepoTreeResponse | null>;
  onDeepFocusEditorToggle?: (expanded: boolean) => void;
  editorOpen?: boolean;
};

type DeepFocusMode = 'distributed' | 'monolith';

type DeepFocusDraft = {
  selectedWorkingFocusIds: string[];
  state: ContextPackDeepFocusState;
};

type TopLevelTarget = {
  id: string;
  label: string;
  rootPath: string;
  repoLocalPath: string;
  ancillaryAllowed: boolean;
};

type TreeFrame = {
  topLevelId: string;
  topLevelLabel: string;
  topLevelPath: string;
  repoLocalPath: string;
  currentPath: string;
  entries: ContextPackRepoTreeEntry[];
  truncated: boolean;
};

type DrillDirection = 'forward' | 'backward';

function FolderGlyph(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path
        d="M2.5 4.5a1 1 0 0 1 1-1h2.3l1.2 1.4H12.5a1 1 0 0 1 1 1v5.4a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileGlyph(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <path
        d="M4 2.5h5.2L12 5.3v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M9.2 2.5V5a.8.8 0 0 0 .8.8h2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function SidebarDeepFocusControls({
  selectedPack,
  selectedWorkingFocusIds,
  deepFocusEnabled,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedTestTarget,
  selectedSupportTargets,
  onCommitDeepFocusSelection,
  onListRepoTree,
  onDeepFocusEditorToggle,
  editorOpen = false,
}: SidebarDeepFocusControlsProps): JSX.Element {
  const deepFocusMode: DeepFocusMode =
    selectedPack.estateType === 'distributed-platform' ? 'distributed' : 'monolith';
  const topLevelLabel = deepFocusMode === 'distributed' ? 'Repositories' : 'Focus Areas';
  const topLevelTargets = useMemo<TopLevelTarget[]>(
    () => (
      deepFocusMode === 'distributed'
        ? selectedPack.focusTargets
          .filter(
            (
              target,
            ): target is ContextPackCatalogEntry['focusTargets'][number] & {
              repoId: string;
              repoLocalPath: string;
            } =>
              target.kind === 'repository'
              && typeof target.repoId === 'string'
              && typeof target.repoLocalPath === 'string'
              && target.repoLocalPath.length > 0,
          )
          .map((target) => ({
            id: target.repoId,
            label: target.displayName,
            rootPath: '',
            repoLocalPath: target.repoLocalPath,
            ancillaryAllowed: false,
          }))
        : selectedPack.focusTargets
          .filter(
            (
              target,
            ): target is ContextPackCatalogEntry['focusTargets'][number] & {
              focusId: string;
              repoLocalPath: string;
            } =>
              target.kind === 'focus-area'
              && typeof target.focusId === 'string'
              && typeof target.repoLocalPath === 'string'
              && target.repoLocalPath.length > 0,
          )
          .map((target) => ({
            id: target.focusId,
            label: target.displayName,
            rootPath: normalizeRelativePath(target.relativePath),
            repoLocalPath: target.repoLocalPath,
            ancillaryAllowed: true,
          }))
    ),
    [deepFocusMode, selectedPack.focusTargets],
  );
  const [draft, setDraft] = useState<DeepFocusDraft>({
    selectedWorkingFocusIds: [],
    state: {
      deepFocusEnabled: false,
      deepFocusPrimaryRepoId: null,
      deepFocusPrimaryFocusId: null,
      selectedFocusPath: null,
      selectedFocusTargetKind: null,
      selectedTestTarget: null,
      selectedSupportTargets: [],
    },
  });
  const [currentFrame, setCurrentFrame] = useState<TreeFrame | null>(null);
  const [frameStack, setFrameStack] = useState<TreeFrame[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [showTreeLoading, setShowTreeLoading] = useState(false);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [drillingIndex, setDrillingIndex] = useState<number | null>(null);
  const [selectionTrayCollapsed, setSelectionTrayCollapsed] = useState(true);
  const [drillTransitionClass, setDrillTransitionClass] = useState<string | null>(null);
  const [popoverRowIndex, setPopoverRowIndex] = useState<number | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const topLevelKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const drillTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (drillTimerRef.current !== null) {
        window.clearTimeout(drillTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onDeepFocusEditorToggle?.(false);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeLoading(false);
    setShowTreeLoading(false);
    setSelectionTrayCollapsed(true);
    setDrillTransitionClass(null);
    setFocusedIndex(0);
    setFocusedKey(null);
  }, [selectedPack.contextPackDir]);

  useEffect(() => {
    if (!editorOpen) return;
    rowRefs.current[focusedIndex]?.focus();
  }, [editorOpen, focusedIndex, currentFrame]);

  const committedTopLevel = topLevelTargets.find((target) => target.id === selectedWorkingFocusIds[0])
    ?? topLevelTargets[0]
    ?? null;
  const committedTopLevelId = committedTopLevel?.id ?? null;
  const supportLabels = useMemo(
    () => buildSupportDisplayLabels(selectedSupportTargets, topLevelTargets, committedTopLevelId),
    [selectedSupportTargets, topLevelTargets, committedTopLevelId],
  );
  const draftTopLevelId = draft.selectedWorkingFocusIds[0] ?? '';
  const draftTopLevel = topLevelTargets.find((target) => target.id === draftTopLevelId) ?? null;
  const draftPrimaryTarget = inferDraftPrimaryTarget(
    draft.state.selectedFocusPath,
    draft.state.selectedFocusTargetKind,
  );
  const draftHasExplicitNoTests = draft.state.selectedTestTarget === null;
  const draftHasColocatedPrimaryAndTest = Boolean(
    draftPrimaryTarget
      && draft.state.selectedTestTarget
      && isSameTarget(draftPrimaryTarget, draft.state.selectedTestTarget),
  );
  const selectionTraySummary = [
    draftTopLevel
      ? `Primary: ${getPrimaryDisplayLabel(
        draftTopLevel,
        normalizeRelativePath(draft.state.selectedFocusPath),
      )}`
      : 'Primary: none',
    draft.state.selectedTestTarget
      ? `Test: ${basename(draft.state.selectedTestTarget.path)}`
      : draftHasExplicitNoTests
        ? 'Test: no tests'
        : 'Test: choose target',
    `Support: ${draft.state.selectedSupportTargets.length}`,
  ].join(' · ');

  const derivePrimaryIds = (nextIds: string[]): {
    deepFocusPrimaryRepoId: string | null;
    deepFocusPrimaryFocusId: string | null;
  } => ({
    deepFocusPrimaryRepoId: deepFocusMode === 'distributed' ? (nextIds[0] ?? null) : null,
    deepFocusPrimaryFocusId: deepFocusMode === 'monolith' ? (nextIds[0] ?? null) : null,
  });

  const buildCommit = (
    enabled: boolean,
    nextIds: string[],
    state: Pick<
      ContextPackDeepFocusState,
      'selectedFocusPath'
      | 'selectedFocusTargetKind'
      | 'selectedTestTarget'
      | 'selectedSupportTargets'
    >,
  ): DeepFocusCommit => ({
    deepFocusEnabled: enabled,
    ...derivePrimaryIds(nextIds),
    selectedFocusPath: state.selectedFocusPath,
    selectedFocusTargetKind: state.selectedFocusTargetKind,
    selectedTestTarget: state.selectedTestTarget,
    selectedSupportTargets: state.selectedSupportTargets,
  });

  const closeEditor = () => {
    onDeepFocusEditorToggle?.(false);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeLoading(false);
    setShowTreeLoading(false);
    setSelectionTrayCollapsed(true);
    setFocusedIndex(0);
    setFocusedKey(null);
    setPopoverRowIndex(null);
    setApplyError(null);
  };

  const initializeDraft = (): DeepFocusDraft => {
    const nextTopLevelId = selectedWorkingFocusIds[0] ?? topLevelTargets[0]?.id ?? null;
    const nextTopLevel = topLevelTargets.find((target) => target.id === nextTopLevelId) ?? null;
    const nextPath = selectedFocusPath
      ?? (deepFocusMode === 'monolith' ? nextTopLevel?.rootPath ?? null : null);
    return {
      selectedWorkingFocusIds: nextTopLevelId ? [nextTopLevelId] : [],
      state: {
        deepFocusEnabled: true,
        ...derivePrimaryIds(nextTopLevelId ? [nextTopLevelId] : []),
        selectedFocusPath: nextPath,
        selectedFocusTargetKind: nextPath
          ? (selectedFocusTargetKind ?? 'directory')
          : null,
        selectedTestTarget:
          selectedTestTarget === undefined
            ? undefined
            : selectedTestTarget
              ? { ...selectedTestTarget }
              : null,
        selectedSupportTargets: selectedSupportTargets.map((target) => ({ ...target })),
      },
    };
  };

  const startDrillTransition = (direction: DrillDirection, phase: 'exit' | 'enter') => {
    if (drillTimerRef.current !== null) {
      window.clearTimeout(drillTimerRef.current);
      drillTimerRef.current = null;
    }
    setDrillTransitionClass(`deep-focus-list--drill-${direction}-${phase}`);
    if (phase === 'enter') {
      drillTimerRef.current = window.setTimeout(() => {
        setDrillTransitionClass(null);
        drillTimerRef.current = null;
      }, 220);
    }
  };

  const fetchTree = async (
    target: TopLevelTarget,
    nextPath = target.rootPath,
    nextStack: TreeFrame[] = frameStack,
    direction?: DrillDirection,
  ): Promise<void> => {
    if (direction) {
      startDrillTransition(direction, 'exit');
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setTreeLoading(true);
    setShowTreeLoading(false);
    const loadingTimer = window.setTimeout(() => {
      if (requestIdRef.current === requestId) {
        setShowTreeLoading(true);
      }
    }, 80);

    const response = await onListRepoTree(target.repoLocalPath, nextPath || undefined);
    window.clearTimeout(loadingTimer);
    if (requestIdRef.current !== requestId || !response) {
      return;
    }

    setCurrentFrame({
      topLevelId: target.id,
      topLevelLabel: target.label,
      topLevelPath: target.rootPath,
      repoLocalPath: target.repoLocalPath,
      currentPath: response.currentPath,
      entries: response.entries,
      truncated: response.truncated,
    });
    setFrameStack(nextStack);
    setTreeLoading(false);
    setShowTreeLoading(false);
    setTreeTruncated(response.truncated);
    setFocusedIndex(0);
    setFocusedKey(response.entries[0]?.relativePath ?? `${target.id}:root`);
    setDrillingIndex(null);
    if (direction) {
      startDrillTransition(direction, 'enter');
    }
  };

  const openEditor = async () => {
    const nextDraft = initializeDraft();
    setDraft(nextDraft);
    setSelectionTrayCollapsed(true);
    setPopoverRowIndex(null);
    setApplyError(null);
    onDeepFocusEditorToggle?.(true);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeTruncated(false);
    setFocusedIndex(0);
    setFocusedKey(nextDraft.selectedWorkingFocusIds[0] ?? topLevelTargets[0]?.id ?? null);
  };

  const applyDraft = () => {
    if (!draftTopLevel) {
      setApplyError('Select a Primary target before applying.');
      return;
    }
    if (draft.state.selectedTestTarget && draft.state.selectedTestTarget.kind === 'file') {
      setApplyError('Test target must be a folder, not a file.');
      return;
    }
    setApplyError(null);
    setPopoverRowIndex(null);
    onCommitDeepFocusSelection(
      buildCommit(true, draft.selectedWorkingFocusIds.slice(0, 1), draft.state),
    );
    closeEditor();
  };

  const handleToggleDeepFocus = () => {
    if (deepFocusEnabled) {
      closeEditor();
      // Preserve selections — only flip the enabled flag
      onCommitDeepFocusSelection(
        buildCommit(false, selectedWorkingFocusIds, {
          selectedFocusPath,
          selectedFocusTargetKind,
          selectedTestTarget,
          selectedSupportTargets,
        }),
      );
      return;
    }

    const nextTopLevelId = selectedWorkingFocusIds[0] ?? topLevelTargets[0]?.id;
    onCommitDeepFocusSelection(
      buildCommit(true, nextTopLevelId ? [nextTopLevelId] : [], {
        selectedFocusPath,
        selectedFocusTargetKind,
        selectedTestTarget,
        selectedSupportTargets,
      }),
    );
  };

  const handleClearAll = () => {
    setApplyError(null);
    setPopoverRowIndex(null);
    setDraft((current) => ({
      selectedWorkingFocusIds: current.selectedWorkingFocusIds,
      state: {
        ...current.state,
        selectedFocusPath: null,
        selectedFocusTargetKind: null,
        selectedTestTarget: undefined,
        selectedSupportTargets: [],
      },
    }));
  };

  const handleDismissNoTests = () => {
    setDraft((current) => ({
      ...current,
      state: {
        ...current.state,
        selectedTestTarget: null,
      },
    }));
  };

  const handleAssignRole = (
    role: FocusRole,
    topLevelId: string,
    target: ContextPackDeepFocusTarget,
  ) => {
    setApplyError(null);
    setDraft((current) => {
      const currentPrimary = inferDraftPrimaryTarget(
        current.state.selectedFocusPath,
        current.state.selectedFocusTargetKind,
      );
      const isPrimaryMatch = currentPrimary
        && isSameTarget(currentPrimary, target)
        && topLevelId === current.selectedWorkingFocusIds[0];
      const isTestMatch = isSameTarget(current.state.selectedTestTarget, target);
      const isSupportMatch = current.state.selectedSupportTargets.some(
        (s) => isSameTarget(s, target),
      );

      if (role === 'primary') {
        const nextTest = isTestMatch ? undefined : current.state.selectedTestTarget;
        const nextSupport = current.state.selectedSupportTargets.filter(
          (s) => !isSameTarget(s, target),
        );
        return {
          selectedWorkingFocusIds: [topLevelId],
          state: {
            ...current.state,
            deepFocusEnabled: true,
            selectedFocusPath: normalizeRelativePath(target.path) || null,
            selectedFocusTargetKind: target.kind,
            selectedTestTarget: nextTest,
            selectedSupportTargets: nextSupport,
          },
        };
      }

      if (role === 'test') {
        const nextTest = isTestMatch ? undefined : target;
        const nextFocusPath = isPrimaryMatch ? null : current.state.selectedFocusPath;
        const nextFocusKind = isPrimaryMatch ? null : current.state.selectedFocusTargetKind;
        const nextSupport = current.state.selectedSupportTargets.filter(
          (s) => !isSameTarget(s, target),
        );
        return {
          ...current,
          state: {
            ...current.state,
            selectedFocusPath: nextFocusPath,
            selectedFocusTargetKind: nextFocusKind,
            selectedTestTarget: nextTest,
            selectedSupportTargets: nextSupport,
          },
        };
      }

      // role === 'support'
      const nextSupport = isSupportMatch
        ? current.state.selectedSupportTargets.filter(
          (s) => !isSameTarget(s, target),
        )
        : [...current.state.selectedSupportTargets, target];
      const nextFocusPath = isPrimaryMatch ? null : current.state.selectedFocusPath;
      const nextFocusKind = isPrimaryMatch ? null : current.state.selectedFocusTargetKind;
      const nextTest = isTestMatch ? undefined : current.state.selectedTestTarget;
      return {
        ...current,
        state: {
          ...current.state,
          selectedFocusPath: nextFocusPath,
          selectedFocusTargetKind: nextFocusKind,
          selectedTestTarget: nextTest,
          selectedSupportTargets: nextSupport,
        },
      };
    });
  };

  const currentRows: TreeRowData[] = currentFrame
    ? currentFrame.entries.map((entry) => ({
      id: `tree:${entry.relativePath || entry.name}`,
      label: entry.name,
      displayPath: entry.relativePath,
      targetPath: entry.relativePath,
      kind: entry.kind,
      hasChildren: entry.hasChildren,
      topLevelId: currentFrame.topLevelId,
      topLevelLabel: currentFrame.topLevelLabel,
      topLevelPath: currentFrame.topLevelPath,
      repoLocalPath: currentFrame.repoLocalPath,
      isTopLevel: false,
      ancillaryAllowed: true,
    }))
    : topLevelTargets.map((target) => ({
      id: `top:${target.id}`,
      label: target.label,
      displayPath: target.rootPath || target.label,
      targetPath: target.rootPath,
      kind: 'directory' as const,
      hasChildren: true,
      topLevelId: target.id,
      topLevelLabel: target.label,
      topLevelPath: target.rootPath,
      repoLocalPath: target.repoLocalPath,
      isTopLevel: true,
      ancillaryAllowed: target.ancillaryAllowed,
    }));

  const breadcrumbs: BreadcrumbItem[] = currentFrame
    ? [
      {
        key: 'roots',
        label: topLevelLabel,
        action: () => {
          setCurrentFrame(null);
          setFrameStack([]);
          setFocusedKey(topLevelKeyRef.current ?? topLevelTargets[0]?.id ?? null);
        },
      },
      {
        key: `root:${currentFrame.topLevelId}`,
        label: currentFrame.topLevelLabel,
        action: () => {
            const target = topLevelTargets.find((entry) => entry.id === currentFrame.topLevelId);
            if (target) {
              void fetchTree(target, target.rootPath, [], 'backward');
            }
          },
        },
      ...removePathPrefix(
        currentFrame.currentPath,
        deepFocusMode === 'monolith' ? currentFrame.topLevelPath : '',
      )
        .split('/')
        .filter(Boolean)
        .map((segment, index, segments) => ({
          key: `${currentFrame.topLevelId}:${segments.slice(0, index + 1).join('/')}`,
          label: segment,
          action: () => {
            const target = topLevelTargets.find((entry) => entry.id === currentFrame.topLevelId);
            if (!target) return;
            const nextRelativePath = segments.slice(0, index + 1).join('/');
              const nextPath = deepFocusMode === 'monolith'
                ? joinRelativePath(currentFrame.topLevelPath, nextRelativePath)
                : nextRelativePath;
              const nextStack = frameStack.slice(0, Math.max(index, 0));
              void fetchTree(target, nextPath, nextStack, 'backward');
            },
          })),
    ]
    : [{ key: 'roots', label: topLevelLabel, action: null }];
  const hiddenBreadcrumbs = breadcrumbs.length > 4
    ? breadcrumbs.slice(1, -3)
    : [];
  const visibleBreadcrumbs = breadcrumbs.length > 4
    ? [breadcrumbs[0], ...breadcrumbs.slice(-3)]
    : breadcrumbs;

  const moveFocus = (direction: -1 | 1) => {
    if (currentRows.length === 0) return;
    setFocusedIndex((current) => {
      const next = Math.min(currentRows.length - 1, Math.max(0, current + direction));
      setFocusedKey(currentRows[next]?.id ?? null);
      return next;
    });
  };

  const handleBack = () => {
    if (!currentFrame) {
      closeEditor();
      return;
    }
    startDrillTransition('backward', 'exit');
    if (frameStack.length === 0) {
      setCurrentFrame(null);
      setFocusedIndex(0);
      setFocusedKey(topLevelKeyRef.current ?? topLevelTargets[0]?.id ?? null);
      window.setTimeout(() => startDrillTransition('backward', 'enter'), 0);
      return;
    }
    const previousFrame = frameStack[frameStack.length - 1];
    setCurrentFrame(previousFrame);
    setFrameStack((current) => current.slice(0, -1));
    setFocusedIndex(0);
    setFocusedKey(previousFrame.entries[0]?.relativePath ?? previousFrame.topLevelId);
    window.setTimeout(() => startDrillTransition('backward', 'enter'), 0);
  };

  const handleRowActivate = async (rowIndex: number) => {
    const row = currentRows[rowIndex];
    if (!row) return;
    setFocusedIndex(rowIndex);
    setFocusedKey(row.id);
    if (row.kind === 'directory') {
      setDrillingIndex(rowIndex);
    }

    const topLevelTarget = topLevelTargets.find((target) => target.id === row.topLevelId);
    if (!topLevelTarget) return;

    if (row.isTopLevel) {
      topLevelKeyRef.current = row.topLevelId;
      await fetchTree(topLevelTarget, topLevelTarget.rootPath, [], 'forward');
      return;
    }

    if (row.kind === 'directory' && currentFrame) {
      const nextStack = [...frameStack, currentFrame];
      await fetchTree(topLevelTarget, row.targetPath, nextStack, 'forward');
    }
  };

  const handleEditorKeyDown = async (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      applyDraft();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handleBack();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      await handleRowActivate(focusedIndex);
    }
  };

  return (
    <>
      <div className="sidebar-section">
        <div
          className={classNames(
            'scope-card',
            'deep-focus-shell',
          )}
          data-testid={editorOpen ? 'deep-focus-editor' : 'deep-focus-summary'}
        >
          <div className="scope-card__header">
            <span className="scope-card__title">Workspace Selection</span>
            <div className="deep-focus-toggle-row">
              <span className="deep-focus-toggle-row__label">Deep Focus Mode</span>
              <button
                type="button"
                className={classNames('deep-focus-toggle', deepFocusEnabled && 'deep-focus-toggle--active')}
                aria-label="Toggle Deep Focus"
                aria-pressed={deepFocusEnabled}
                onClick={handleToggleDeepFocus}
              >
                <span className="deep-focus-toggle__knob" />
              </button>
            </div>
          </div>

          {!editorOpen ? (
            <div className="deep-focus-summary">
              {committedTopLevel ? (
                <>
                  <div className="deep-focus-summary__header">
                    <span className="deep-focus-summary__header-title">Focus Targets</span>
                    <button
                      type="button"
                      className="deep-focus-summary__edit-link"
                      onClick={() => { void openEditor(); }}
                    >
                      Edit
                    </button>
                  </div>
                  <div className="deep-focus-summary__selections">
                    <div className="deep-focus-summary__selection-row deep-focus-summary__selection-row--primary">
                      <span className="deep-focus-summary__selection-dot" />
                      <span className="deep-focus-summary__selection-label">Primary</span>
                      <span className="deep-focus-summary__selection-value" title={selectedFocusPath ?? committedTopLevel.rootPath ?? committedTopLevel.label}>
                        {getPrimaryDisplayLabel(committedTopLevel, selectedFocusPath ?? '')}
                      </span>
                    </div>

                    <div className={classNames(
                      'deep-focus-summary__selection-row',
                      'deep-focus-summary__selection-row--test',
                      !selectedTestTarget && 'deep-focus-summary__selection-row--empty',
                    )}>
                      <span className="deep-focus-summary__selection-dot" />
                      <span className="deep-focus-summary__selection-label">Test</span>
                      <span className="deep-focus-summary__selection-value" title={selectedTestTarget?.path ?? ''}>
                        {selectedTestTarget
                          ? (selectedTestTarget.path ? basename(selectedTestTarget.path) : committedTopLevel?.label ?? 'Repo root')
                          : 'None'}
                      </span>
                    </div>

                    {selectedSupportTargets.length > 0 ? (
                      <>
                        <div className="deep-focus-summary__section-divider" />
                        <div className="deep-focus-summary__support-header">
                          <span className="deep-focus-summary__selection-dot deep-focus-summary__selection-dot--support" />
                          <span className="deep-focus-summary__selection-label">Support</span>
                          <span className="deep-focus-summary__support-count">{selectedSupportTargets.length}</span>
                        </div>
                        <div className="deep-focus-summary__support-list">
                          {selectedSupportTargets.map((target, index) => (
                            <div
                              key={`${target.kind}:${target.path || supportLabels.get(index) || index}`}
                              className="deep-focus-summary__support-item"
                              title={target.path || (supportLabels.get(index) ?? basename(target.path))}
                            >
                              <span className="deep-focus-summary__support-icon">{target.kind === 'directory' ? <FolderGlyph /> : <FileGlyph />}</span>
                              <span className="deep-focus-summary__support-name">{supportLabels.get(index) ?? basename(target.path)}</span>
                              <span className="deep-focus-summary__support-path">{target.path}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="deep-focus-summary__selection-row deep-focus-summary__selection-row--support deep-focus-summary__selection-row--empty">
                        <span className="deep-focus-summary__selection-dot" />
                        <span className="deep-focus-summary__selection-label">Support</span>
                        <span className="deep-focus-summary__selection-value">None</span>
                      </div>
                    )}
                  </div>

                  <div className="deep-focus-summary__metrics">
                    <span>{selectedPack.repoCount} {selectedPack.repoCount === 1 ? 'repo' : 'repos'}</span>
                    {selectedPack.workspaceFolderCount != null ? (
                      <>
                        <span className="deep-focus-summary__metrics-sep" />
                        <span>{formatNumber(selectedPack.workspaceFolderCount)} {selectedPack.workspaceFolderCount === 1 ? 'folder' : 'folders'}</span>
                      </>
                    ) : null}
                    {selectedPack.workspaceFileCount != null ? (
                      <>
                        <span className="deep-focus-summary__metrics-sep" />
                        <span>{formatNumber(selectedPack.workspaceFileCount)} {selectedPack.workspaceFileCount === 1 ? 'file' : 'files'}</span>
                      </>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="deep-focus-summary__empty">No focus target selected</p>
                  <button
                    type="button"
                    className="deep-focus-summary__action"
                    onClick={() => { void openEditor(); }}
                  >
                    Select Focus
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="deep-focus-editor" onKeyDown={(event) => { void handleEditorKeyDown(event); }}>
              <DeepFocusBreadcrumb
                visibleBreadcrumbs={visibleBreadcrumbs}
                hiddenBreadcrumbs={hiddenBreadcrumbs}
              />

              <div className="deep-focus-editor__nav">
                {currentFrame ? (
                  <button
                    type="button"
                    className="deep-focus-back-button"
                    onClick={handleBack}
                    aria-label="Back one level"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ transform: 'rotate(180deg)' }}>
                      <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>Back</span>
                  </button>
                ) : (
                  <span className="deep-focus-back-button-placeholder" />
                )}
                <div className="deep-focus-editor__nav-right">
                  <button
                    type="button"
                    className="deep-focus-clear-all-button"
                    onClick={handleClearAll}
                    aria-label="Clear all selections"
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    className="deep-focus-done-button"
                    onClick={closeEditor}
                    aria-label="Close editor"
                  >
                    Done
                  </button>
                </div>
              </div>

              <div className="deep-focus-editor__body">
                <div
                  className={classNames(
                    'deep-focus-list',
                    treeLoading && 'deep-focus-list--loading',
                    drillTransitionClass,
                  )}
                  role="list"
                  aria-label="Deep Focus tree"
                >
                  {showTreeLoading ? (
                    Array.from({ length: 4 }).map((_, index) => (
                      <div key={`loading-${index}`} className="deep-focus-loading-row" />
                    ))
                  ) : currentRows.length > 0 ? (
                    currentRows.map((row, index) => {
                      const target: ContextPackDeepFocusTarget = {
                        path: row.targetPath,
                        kind: row.kind,
                      };
                      const isPrimary = row.topLevelId === draftTopLevelId
                        && normalizeRelativePath(row.targetPath)
                          === normalizeRelativePath(draft.state.selectedFocusPath);
                      const isTest = isSameTarget(draft.state.selectedTestTarget, target);
                      const isSupport = draft.state.selectedSupportTargets.some(
                        (supportTarget) => isSameTarget(supportTarget, target),
                      );

                      return (
                        <DeepFocusTreeRow
                          key={row.id}
                          row={row}
                          index={index}
                          focusedIndex={focusedIndex}
                          focusedKey={focusedKey}
                          drillingIndex={drillingIndex}
                          isPrimary={isPrimary}
                          isTest={isTest}
                          isSupport={isSupport}
                          popoverOpen={popoverRowIndex === index}
                          rowRef={(element) => { rowRefs.current[index] = element; }}
                          onFocus={(i, id) => { setFocusedIndex(i); setFocusedKey(id); }}
                          onActivate={(i) => { void handleRowActivate(i); }}
                          onLongPress={(i) => { setPopoverRowIndex(i); }}
                          onAssignRole={handleAssignRole}
                          onDismissPopover={() => { setPopoverRowIndex(null); }}
                        />
                      );
                    })
                  ) : (
                    <div className="deep-focus-empty-state">No items</div>
                  )}
                  {treeTruncated ? (
                    <div className="deep-focus-truncation-notice">Showing first 500 items</div>
                  ) : null}
                </div>

                <DeepFocusSelectionTray
                  collapsed={selectionTrayCollapsed}
                  onToggleCollapsed={() => setSelectionTrayCollapsed((current) => !current)}
                  summaryLine={selectionTraySummary}
                  draftTopLevel={draftTopLevel}
                  draftState={draft.state}
                  draftHasColocatedPrimaryAndTest={draftHasColocatedPrimaryAndTest}
                  draftHasExplicitNoTests={draftHasExplicitNoTests}
                  onDismissNoTests={handleDismissNoTests}
                />

                <div className="deep-focus-footer">
                  {applyError ? (
                    <p className="deep-focus-footer__error" role="alert">{applyError}</p>
                  ) : null}
                  <div className="deep-focus-footer__actions">
                    <button
                      type="button"
                      className="action-button action-button--secondary"
                      onClick={closeEditor}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="action-button action-button--primary"
                      onClick={applyDraft}
                      disabled={!draftTopLevel}
                    >
                      Apply
                    </button>
                  </div>
                  <p className="deep-focus-footer__hint">Touch and hold to assign a role</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!editorOpen && selectedPack.lastSyncedAt ? (
        <p
          className="deep-focus-synced-caption"
          title={selectedPack.lastSyncedAt}
          data-testid="context-pack-selection-summary"
        >
          Synced {formatRelativeTime(selectedPack.lastSyncedAt)}
        </p>
      ) : null}
    </>
  );
}

export default SidebarDeepFocusControls;
