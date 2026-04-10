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
import { DeepFocusBreadcrumb, type BreadcrumbItem } from './DeepFocusBreadcrumb';
import { DeepFocusSelectionTray } from './DeepFocusSelectionTray';
import { DeepFocusTreeRow, type TreeRowData } from './DeepFocusTreeRow';
import {
  basename,
  countKinds,
  formatRelativeTime,
  getPrimaryDisplayLabel,
  getPrimaryDisplayPath,
  inferDraftPrimaryTarget,
  joinRelativePath,
  normalizeRelativePath,
  pathContains,
  removePathPrefix,
  targetsOverlap,
  isSameTarget,
} from './SidebarDeepFocusUtils';

export type DeepFocusCommit = {
  deepFocusEnabled: boolean;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
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
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<DeepFocusDraft>({
    selectedWorkingFocusIds: [],
    state: {
      deepFocusEnabled: false,
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
  const [backdropPhase, setBackdropPhase] =
    useState<'hidden' | 'visible' | 'closing'>('hidden');
  const [drillTransitionClass, setDrillTransitionClass] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const topLevelKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const backdropTimerRef = useRef<number | null>(null);
  const drillTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onDeepFocusEditorToggle?.(editorOpen);
  }, [editorOpen, onDeepFocusEditorToggle]);

  useEffect(() => {
    if (editorOpen) {
      if (backdropTimerRef.current !== null) {
        window.clearTimeout(backdropTimerRef.current);
        backdropTimerRef.current = null;
      }
      setBackdropPhase('visible');
      return;
    }

    if (backdropPhase === 'visible') {
      setBackdropPhase('closing');
      backdropTimerRef.current = window.setTimeout(() => {
        setBackdropPhase('hidden');
        backdropTimerRef.current = null;
      }, 220);
    }
  }, [backdropPhase, editorOpen]);

  useEffect(() => {
    return () => {
      if (backdropTimerRef.current !== null) {
        window.clearTimeout(backdropTimerRef.current);
      }
      if (drillTimerRef.current !== null) {
        window.clearTimeout(drillTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setEditorOpen(false);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeLoading(false);
    setShowTreeLoading(false);
    setSelectionTrayCollapsed(true);
    setBackdropPhase('hidden');
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
  const committedPrimaryPath = normalizeRelativePath(
    selectedFocusPath ?? (deepFocusMode === 'monolith' ? committedTopLevel?.rootPath : null),
  );
  const committedPrimaryTarget = committedTopLevel
    ? {
      path: committedPrimaryPath,
      kind: selectedFocusTargetKind ?? 'directory',
    }
    : null;
  const compactTargets = committedPrimaryTarget
    ? [
      committedPrimaryTarget,
      ...(selectedTestTarget ? [selectedTestTarget] : []),
      ...selectedSupportTargets,
    ]
    : [];
  const compactCounts = countKinds(compactTargets);
  const hasColocatedPrimaryAndTest = Boolean(
    committedPrimaryTarget && isSameTarget(committedPrimaryTarget, selectedTestTarget),
  );
  const supportPreview = selectedSupportTargets.slice(0, 3);
  const supportOverflow = Math.max(0, selectedSupportTargets.length - supportPreview.length);
  const hasExplicitNoTests = selectedTestTarget === null;
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
    selectedRepoIds: deepFocusMode === 'distributed' ? nextIds : [],
    selectedFocusIds: deepFocusMode === 'monolith' ? nextIds : [],
    selectedFocusPath: state.selectedFocusPath,
    selectedFocusTargetKind: state.selectedFocusTargetKind,
    selectedTestTarget: state.selectedTestTarget,
    selectedSupportTargets: state.selectedSupportTargets,
  });

  const closeEditor = () => {
    setEditorOpen(false);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeLoading(false);
    setShowTreeLoading(false);
    setSelectionTrayCollapsed(true);
    setFocusedIndex(0);
    setFocusedKey(null);
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
    setEditorOpen(true);
    setCurrentFrame(null);
    setFrameStack([]);
    setTreeTruncated(false);
    setFocusedIndex(0);
    setFocusedKey(nextDraft.selectedWorkingFocusIds[0] ?? topLevelTargets[0]?.id ?? null);
  };

  const applyDraft = () => {
    onCommitDeepFocusSelection(
      buildCommit(true, draft.selectedWorkingFocusIds.slice(0, 1), draft.state),
    );
    closeEditor();
  };

  const handleToggleDeepFocus = () => {
    if (deepFocusEnabled) {
      closeEditor();
      onCommitDeepFocusSelection(
        buildCommit(false, selectedWorkingFocusIds, {
          selectedFocusPath: null,
          selectedFocusTargetKind: null,
          selectedTestTarget: null,
          selectedSupportTargets: [],
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

  const handleSelectPrimary = (
    topLevelId: string,
    nextTarget: ContextPackDeepFocusTarget,
  ) => {
    setDraft((current) => {
      const nextState: ContextPackDeepFocusState = {
        ...current.state,
        deepFocusEnabled: true,
        selectedFocusPath: normalizeRelativePath(nextTarget.path) || null,
        selectedFocusTargetKind: nextTarget.kind,
        selectedSupportTargets: current.state.selectedSupportTargets.filter((target) => {
          if (deepFocusMode === 'distributed' && topLevelId !== current.selectedWorkingFocusIds[0]) {
            return false;
          }
          if (nextTarget.kind === 'file') {
            return target.path !== nextTarget.path;
          }
          return !pathContains(nextTarget.path, target.path);
        }),
      };
      if (
        deepFocusMode === 'distributed'
        && topLevelId !== current.selectedWorkingFocusIds[0]
      ) {
        nextState.selectedSupportTargets = [];
        nextState.selectedTestTarget = null;
      }
      return {
        selectedWorkingFocusIds: [topLevelId],
        state: nextState,
      };
    });
  };

  const handleToggleTestTarget = (target: ContextPackDeepFocusTarget) => {
    setDraft((current) => ({
      ...current,
      state: {
        ...current.state,
        selectedTestTarget: isSameTarget(current.state.selectedTestTarget, target)
          ? undefined
          : target,
        selectedSupportTargets: current.state.selectedSupportTargets.filter(
          (supportTarget) => !targetsOverlap(supportTarget, target),
        ),
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

  const supportDisabledReason = (row: TreeRowData): boolean => {
    if (!row.ancillaryAllowed) {
      return true;
    }
    const target = { path: row.targetPath, kind: row.kind } satisfies ContextPackDeepFocusTarget;
    if (
      deepFocusMode === 'distributed'
      && row.topLevelId !== draftTopLevelId
    ) {
      return true;
    }
    if (draft.state.selectedTestTarget && targetsOverlap(draft.state.selectedTestTarget, target)) {
      return true;
    }
    if (!draftPrimaryTarget) {
      return false;
    }
    if (draftPrimaryTarget.kind === 'file') {
      return draftPrimaryTarget.path === target.path;
    }
    return pathContains(draftPrimaryTarget.path, target.path);
  };

  const handleToggleSupport = (target: ContextPackDeepFocusTarget, row: TreeRowData) => {
    if (supportDisabledReason(row)) return;
    setDraft((current) => {
      const exists = current.state.selectedSupportTargets.some(
        (supportTarget) =>
          supportTarget.path === target.path && supportTarget.kind === target.kind,
      );
      return {
        ...current,
        state: {
          ...current.state,
          selectedSupportTargets: exists
            ? current.state.selectedSupportTargets.filter(
              (supportTarget) =>
                supportTarget.path !== target.path || supportTarget.kind !== target.kind,
            )
            : [...current.state.selectedSupportTargets, target],
        },
      };
    });
  };

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
      {backdropPhase !== 'hidden' ? (
        <button
          type="button"
          className={classNames(
            'deep-focus-backdrop',
            backdropPhase === 'visible' && 'deep-focus-backdrop--visible',
            backdropPhase === 'closing' && 'deep-focus-backdrop--closing',
          )}
          aria-label="Cancel Deep Focus editing"
          disabled={backdropPhase === 'closing'}
          onClick={closeEditor}
        />
      ) : null}
      <div className="sidebar-section">
        <div
          className={classNames(
            'scope-card',
            'deep-focus-shell',
            editorOpen && 'deep-focus-shell--expanded',
          )}
          data-testid={editorOpen ? 'deep-focus-editor' : 'deep-focus-summary'}
        >
          <div className="scope-card__header">
            <span className="scope-card__title">Workspace Focus</span>
            <div className="deep-focus-toggle-row">
              <span className="deep-focus-toggle-row__label">Deep Focus</span>
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
                  <div
                    className={classNames(
                      'deep-focus-summary__primary',
                      hasColocatedPrimaryAndTest && 'deep-focus-summary__primary--colocated',
                    )}
                  >
                    <div className="deep-focus-summary__title-row">
                      <span className="deep-focus-summary__title">
                        {getPrimaryDisplayLabel(committedTopLevel, committedPrimaryPath)}
                      </span>
                      <span className="status-chip status-chip--xs status-chip--active">Active</span>
                    </div>
                    <span
                      className="deep-focus-summary__path"
                      title={getPrimaryDisplayPath(committedTopLevel, committedPrimaryPath)}
                    >
                      {getPrimaryDisplayPath(committedTopLevel, committedPrimaryPath)}
                    </span>
                  </div>

                  {selectedTestTarget && !hasColocatedPrimaryAndTest ? (
                    <div className="deep-focus-summary__test">
                      <span className="deep-focus-summary__title">
                        Test: {basename(selectedTestTarget.path)}
                      </span>
                      <span className="deep-focus-summary__path" title={selectedTestTarget.path}>
                        {selectedTestTarget.path}
                      </span>
                    </div>
                  ) : hasExplicitNoTests ? (
                    <div className="deep-focus-summary__test deep-focus-summary__test--dismissed">
                      <span className="deep-focus-summary__title">No tests</span>
                      <span className="deep-focus-summary__path">
                        Explicitly applied without a dedicated test target
                      </span>
                    </div>
                  ) : null}

                  {supportPreview.map((target) => (
                    <div key={`${target.kind}:${target.path}`} className="deep-focus-summary__support">
                      <span className="deep-focus-summary__title">{basename(target.path)}</span>
                      <span className="deep-focus-summary__path" title={target.path}>
                        {target.path}
                      </span>
                    </div>
                  ))}
                  {supportOverflow > 0 ? (
                    <div className="deep-focus-summary__overflow">+{supportOverflow} more</div>
                  ) : null}
                  {(compactCounts.directoryCount > 0 || compactCounts.fileCount > 0) ? (
                    <div className="deep-focus-summary__metrics">
                      {compactCounts.directoryCount} folders · {compactCounts.fileCount} files
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="deep-focus-summary__empty">No focus target selected</p>
              )}

              <button
                type="button"
                className="action-button action-button--secondary deep-focus-summary__action"
                onClick={() => { void openEditor(); }}
              >
                {committedTopLevel ? 'Edit Focus' : 'Select Focus'}
              </button>
            </div>
          ) : (
            <div className="deep-focus-editor" onKeyDown={(event) => { void handleEditorKeyDown(event); }}>
              <DeepFocusBreadcrumb
                visibleBreadcrumbs={visibleBreadcrumbs}
                hiddenBreadcrumbs={hiddenBreadcrumbs}
              />

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
                      const isTest = row.ancillaryAllowed && isSameTarget(draft.state.selectedTestTarget, target);
                      const isSupport = row.ancillaryAllowed && draft.state.selectedSupportTargets.some(
                        (supportTarget) => supportTarget.path === target.path && supportTarget.kind === target.kind,
                      );
                      const isSupportDisabled = supportDisabledReason(row);
                      const testDisabled = !row.ancillaryAllowed
                        || (deepFocusMode === 'distributed' && row.topLevelId !== draftTopLevelId)
                        || isSupport;

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
                          testDisabled={testDisabled}
                          supportDisabled={isSupportDisabled}
                          rowRef={(element) => { rowRefs.current[index] = element; }}
                          onFocus={(i, id) => { setFocusedIndex(i); setFocusedKey(id); }}
                          onSelectPrimary={handleSelectPrimary}
                          onActivate={(i) => { void handleRowActivate(i); }}
                          onToggleTest={handleToggleTestTarget}
                          onToggleSupport={handleToggleSupport}
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
              </div>

              <button
                type="button"
                className="deep-focus-back-button"
                onClick={handleBack}
                aria-label={currentFrame ? 'Back one level' : 'Cancel Deep Focus editing'}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" style={{ transform: 'rotate(180deg)' }}>
                  <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Back</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {!editorOpen ? (
        <div className="sidebar-section sidebar-selection-detail" data-testid="context-pack-selection-summary">
          {selectedPack.lastSyncedAt ? (
            <p className="sidebar-meta" title={selectedPack.lastSyncedAt}>
              Synced {formatRelativeTime(selectedPack.lastSyncedAt)}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export default SidebarDeepFocusControls;
