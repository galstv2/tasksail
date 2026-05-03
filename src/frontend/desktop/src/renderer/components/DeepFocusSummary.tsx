import { useEffect, useMemo, useState, type RefObject } from 'react';

import type {
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
} from '../../shared/desktopContract';
import { normalizeRelativePath, primaryIdentityKey, type EditScopeCursor } from './SidebarDeepFocusUtils';
import type { TopLevelTarget } from './SidebarDeepFocusControls.types';
import {
  buildScopeSummaryViewModel,
  type ScopeSummaryViewModel,
  type SummaryPrimaryRow,
} from './sidebarDeepFocusSelectors';
import { TestGlyph } from './DeepFocusGlyphs';

type DeepFocusSummaryProps = {
  committedTopLevel: TopLevelTarget | null;
  committedPrimaries: ContextPackPrimaryFocusTarget[];
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
  actionRef?: RefObject<HTMLButtonElement>;
  onOpenEditor: (cursor?: EditScopeCursor) => void;
};

function SupportGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 14 14"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 2h6l3 3v7H3z" />
      <path d="M5.5 6.5h3M5.5 9h3" />
    </svg>
  );
}

function ChevronGlyph(): JSX.Element {
  return (
    <svg
      className="deep-focus-summary__chevron"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  );
}

function renderPath(path: string): JSX.Element {
  const norm = normalizeRelativePath(path);
  const lastSlash = norm.lastIndexOf('/');
  if (lastSlash <= 0) {
    return (
      <span className="deep-focus-summary__path" title={norm || '/'}>
        <span className="deep-focus-summary__path-basename">{norm || '/'}</span>
      </span>
    );
  }
  return (
    <span className="deep-focus-summary__path" title={norm}>
      <span className="deep-focus-summary__path-parent" dir="ltr">
        {norm.slice(0, lastSlash + 1)}
      </span>
      <span className="deep-focus-summary__path-basename">{norm.slice(lastSlash + 1)}</span>
    </span>
  );
}

function basenameOf(path: string): string {
  const norm = normalizeRelativePath(path);
  const slash = norm.lastIndexOf('/');
  return slash < 0 ? norm : norm.slice(slash + 1);
}

function renderSupportList(targets: ContextPackDeepFocusTarget[]): JSX.Element {
  if (targets.length === 0) return <></>;
  if (targets.length === 1) return renderPath(targets[0].path);
  if (targets.length === 2) {
    return (
      <span className="deep-focus-summary__path-basename">
        {basenameOf(targets[0].path)} · {basenameOf(targets[1].path)}
      </span>
    );
  }
  return (
    <span className="deep-focus-summary__path-basename">
      {basenameOf(targets[0].path)} · {basenameOf(targets[1].path)} +{targets.length - 2}
    </span>
  );
}

function renderPreview(targets: ContextPackDeepFocusTarget[]): string {
  if (targets.length <= 2) {
    return targets.map((t) => basenameOf(t.path)).join(' · ');
  }
  return `${basenameOf(targets[0].path)} · ${basenameOf(targets[1].path)} +${targets.length - 2}`;
}

function Indicator({
  kind,
  count,
}: {
  kind: 'test' | 'support';
  count?: number;
}): JSX.Element {
  if (kind === 'test') {
    return (
      <span className="deep-focus-summary__indicator">
        <TestGlyph />
        <span className="sr-only">Has scoped test target</span>
      </span>
    );
  }
  return (
    <span className="deep-focus-summary__indicator">
      <SupportGlyph />
      <span className="deep-focus-summary__indicator-count" aria-hidden="true">
        {count ?? 0}
      </span>
      <span className="sr-only">{count ?? 0} scoped support files</span>
    </span>
  );
}

function PrimaryRowContents({ row }: { row: SummaryPrimaryRow }): JSX.Element {
  const fullLabel = row.repoPrefixLabel
    ? `${row.repoPrefixLabel}/${row.basenameLabel}`
    : row.basenameLabel;
  return (
    <>
      <span className="deep-focus-summary__anchor-dot" aria-hidden="true" />
      <span className="deep-focus-summary__primary-label" title={fullLabel}>
        {row.repoPrefixLabel ? (
          <>
            <span className="deep-focus-summary__primary-label-prefix" dir="ltr">
              {row.repoPrefixLabel}
            </span>
            <span className="deep-focus-summary__primary-label-sep">/</span>
          </>
        ) : null}
        <span className="deep-focus-summary__primary-label-name">{row.basenameLabel}</span>
      </span>
      <span className="deep-focus-summary__indicator-group">
        {row.scopedTest ? <Indicator kind="test" /> : null}
        {row.scopedSupports.length > 0 ? (
          <Indicator kind="support" count={row.scopedSupports.length} />
        ) : null}
      </span>
    </>
  );
}

function SummaryPrimaryOverrides({
  id,
  row,
}: {
  id: string;
  row: SummaryPrimaryRow;
}): JSX.Element {
  return (
    <div
      id={id}
      className="deep-focus-summary__overrides"
      role="group"
      aria-label={`Scoped overrides for ${row.basenameLabel}`}
    >
      {row.scopedTest ? (
        <div className="deep-focus-summary__overrides-row">
          <span className="deep-focus-summary__overrides-label">Test</span>
          <span className="deep-focus-summary__overrides-value">
            {renderPath(row.scopedTest.path)}
          </span>
        </div>
      ) : null}
      {row.scopedSupports.length > 0 ? (
        <div className="deep-focus-summary__overrides-row">
          <span className="deep-focus-summary__overrides-label">Support</span>
          <span
            className="deep-focus-summary__overrides-value"
            title={row.scopedSupports.map((target) => target.path).join('\n')}
          >
            {renderSupportList(row.scopedSupports)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SummaryHeader({
  titleSentence,
  actionRef,
  onOpenEditor,
}: {
  titleSentence: string;
  actionRef?: RefObject<HTMLButtonElement>;
  onOpenEditor: () => void;
}): JSX.Element {
  return (
    <div className="deep-focus-summary__header">
      <div className="deep-focus-summary__action-row">
        <button
          type="button"
          ref={actionRef}
          className="deep-focus-summary__action"
          onClick={onOpenEditor}
        >
          Edit Scope
        </button>
      </div>
      <div className="deep-focus-summary__divider" role="presentation" aria-hidden="true" />
      <div className="deep-focus-summary__heading">
        <span className="deep-focus-summary__eyebrow">Scope Summary</span>
        <span className="deep-focus-summary__title">{titleSentence}</span>
      </div>
    </div>
  );
}

function SummaryPrimaryList({
  rows,
}: {
  rows: SummaryPrimaryRow[];
}): JSX.Element {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Reset when row identity changes (count, order, or per-row replacement).
  // `rows.length` alone misses replacement at the expanded index.
  const rowsIdentityKey = useMemo(
    () => rows.map((row) => primaryIdentityKey(row.primary)).join('|'),
    [rows],
  );
  useEffect(() => {
    setExpandedIndex(null);
  }, [rowsIdentityKey]);

  return (
    <ul className="deep-focus-summary__primary-list" role="list">
      {rows.map((row) => {
        const isExpanded = expandedIndex === row.index;
        const overridesId = `deep-focus-summary-overrides-${row.index}`;
        return (
          <li
            key={`${row.index}:${row.primary.repoLocalPath ?? ''}:${row.primary.path}`}
            className="deep-focus-summary__primary-row"
            data-anchor={row.isAnchor || undefined}
            data-expanded={isExpanded || undefined}
          >
            {row.expandable ? (
              <button
                type="button"
                className="deep-focus-summary__primary-row-button"
                aria-expanded={isExpanded}
                aria-controls={overridesId}
                onClick={() => setExpandedIndex(isExpanded ? null : row.index)}
              >
                <PrimaryRowContents row={row} />
                <ChevronGlyph />
              </button>
            ) : (
              <div className="deep-focus-summary__primary-row-static">
                <PrimaryRowContents row={row} />
              </div>
            )}
            {row.expandable && isExpanded ? (
              <SummaryPrimaryOverrides id={overridesId} row={row} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SummaryGlobals({
  globalTest,
  globalSupports,
}: {
  globalTest: ContextPackDeepFocusTarget | null;
  globalSupports: ContextPackDeepFocusTarget[];
}): JSX.Element | null {
  if (!globalTest && globalSupports.length === 0) return null;
  return (
    <section className="deep-focus-summary__globals" aria-label="Support for all primaries">
      <span className="deep-focus-summary__globals-eyebrow">Support for all primaries</span>
      {globalTest ? (
        <div className="deep-focus-summary__globals-row">
          <span className="deep-focus-summary__globals-label">Test</span>
          <span className="deep-focus-summary__globals-value">{renderPath(globalTest.path)}</span>
        </div>
      ) : null}
      {globalSupports.length > 0 ? (
        <div className="deep-focus-summary__globals-row">
          <span className="deep-focus-summary__globals-value">
            {globalSupports.length === 1
              ? renderPath(globalSupports[0].path)
              : `${globalSupports.length} folders`}
            {globalSupports.length > 1 ? (
              <span
                className="deep-focus-summary__globals-preview"
                title={globalSupports.map((target) => target.path).join('\n')}
              >
                {renderPreview(globalSupports)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function DeepFocusSummary({
  committedTopLevel,
  committedPrimaries,
  selectedFocusPath,
  selectedFocusTargetKind,
  selectedTestTarget,
  selectedSupportTargets,
  actionRef,
  onOpenEditor,
}: DeepFocusSummaryProps): JSX.Element {
  const viewModel: ScopeSummaryViewModel = buildScopeSummaryViewModel(
    committedTopLevel,
    committedPrimaries,
    selectedFocusPath,
    selectedFocusTargetKind,
    selectedTestTarget,
    selectedSupportTargets,
  );

  if (viewModel.primaryCount === 0) {
    return (
      <section className="deep-focus-summary" aria-label="Scope Summary">
        <div className="deep-focus-summary__empty-card">
          <div className="deep-focus-summary__action-row">
            <button
              type="button"
              ref={actionRef}
              className="deep-focus-summary__action"
              onClick={() => onOpenEditor()}
            >
              Edit Scope
            </button>
          </div>
          <div className="deep-focus-summary__divider" role="presentation" aria-hidden="true" />
          <div className="deep-focus-summary__empty-body">
            <p className="deep-focus-summary__empty-title">No primary targets</p>
            <p className="deep-focus-summary__empty-copy">Choose what&apos;s in scope for this task.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="deep-focus-summary" aria-label="Scope Summary">
      <div className="deep-focus-summary__card">
        <SummaryHeader
          titleSentence={viewModel.titleSentence}
          actionRef={actionRef}
          onOpenEditor={() => onOpenEditor()}
        />
        <SummaryPrimaryList rows={viewModel.primaryRows} />
        <SummaryGlobals
          globalTest={viewModel.globalTest}
          globalSupports={viewModel.globalSupports}
        />
      </div>
    </section>
  );
}
