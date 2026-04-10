import type { ContextPackDeepFocusTarget, ContextPackFocusTargetKind } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';

export type TreeRowData = {
  id: string;
  label: string;
  displayPath: string;
  targetPath: string;
  kind: ContextPackFocusTargetKind;
  hasChildren: boolean;
  topLevelId: string;
  topLevelLabel: string;
  topLevelPath: string;
  repoLocalPath: string;
  isTopLevel: boolean;
  ancillaryAllowed: boolean;
};

type DeepFocusTreeRowProps = {
  row: TreeRowData;
  index: number;
  focusedIndex: number;
  focusedKey: string | null;
  drillingIndex: number | null;
  isPrimary: boolean;
  isTest: boolean;
  isSupport: boolean;
  testDisabled: boolean;
  supportDisabled: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  onFocus: (index: number, id: string) => void;
  onSelectPrimary: (topLevelId: string, target: ContextPackDeepFocusTarget) => void;
  onActivate: (index: number) => void;
  onToggleTest: (target: ContextPackDeepFocusTarget) => void;
  onToggleSupport: (target: ContextPackDeepFocusTarget, row: TreeRowData) => void;
};

function FolderTreeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.5 4.5a1 1 0 0 1 1-1h2.3l1.2 1.4H12.5a1 1 0 0 1 1 1v1H2.5z"
        fill="currentColor"
        opacity="0.38"
      />
      <path
        d="M2.5 6.5h11v4.8a1.2 1.2 0 0 1-1.2 1.2H3.7a1.2 1.2 0 0 1-1.2-1.2z"
        fill="currentColor"
      />
    </svg>
  );
}

function FileNodeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4 2.5h5.2L12 5.3v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M9.2 2.5V5a.8.8 0 0 0 .8.8h2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 8.2h5.6M5.2 10.4h4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TestTubeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 2.5h4M7 2.5v4.8l-2.2 3.1a2.2 2.2 0 0 0 1.8 3.6h2.8a2.2 2.2 0 0 0 1.8-3.6L9 7.3V2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5.6 11.2h4.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function SupportTargetIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3.1" fill="currentColor" opacity="0.2" />
      <path
        d="M8 3.4v2.1M8 10.5v2.1M3.4 8h2.1M10.5 8h2.1"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  );
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeepFocusTreeRow({
  row,
  index,
  focusedIndex,
  focusedKey,
  drillingIndex,
  isPrimary,
  isTest,
  isSupport,
  testDisabled,
  supportDisabled,
  rowRef,
  onFocus,
  onSelectPrimary,
  onActivate,
  onToggleTest,
  onToggleSupport,
}: DeepFocusTreeRowProps): JSX.Element {
  const target: ContextPackDeepFocusTarget = {
    path: row.targetPath,
    kind: row.kind,
  };

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={focusedIndex === index ? 0 : -1}
      className={classNames(
        'deep-focus-row',
        row.kind === 'directory' ? 'deep-focus-row--directory' : 'deep-focus-row--file',
        isPrimary && 'deep-focus-row--selected',
        !isPrimary && isTest && 'deep-focus-row--test-selected',
        isPrimary && isTest && 'deep-focus-row--primary-and-test',
        isSupport && 'deep-focus-row--support-selected',
      )}
      onFocus={() => { onFocus(index, row.id); }}
      onClick={() => onSelectPrimary(row.topLevelId, target)}
      onDoubleClick={() => { void onActivate(index); }}
      data-focused={focusedKey === row.id ? 'true' : undefined}
    >
      <span className="deep-focus-row__icon" aria-hidden="true">
        {row.kind === 'directory' ? <FolderTreeIcon /> : <FileNodeIcon />}
      </span>
      <span className="deep-focus-row__label">
        <span className="deep-focus-row__title-row">
          <span className="deep-focus-row__name">{row.label}</span>
          {isPrimary ? (
            <span className="status-chip status-chip--xs status-chip--active">Active</span>
          ) : null}
        </span>
        <span className="deep-focus-row__path" title={row.displayPath}>
          {row.displayPath}
        </span>
      </span>
      <button
        type="button"
        className={classNames(
          'deep-focus-row__test-toggle',
          isTest && 'deep-focus-row__test-toggle--active',
          testDisabled && 'deep-focus-row__test-toggle--disabled',
        )}
        aria-label={`Toggle test target for ${row.label}`}
        disabled={testDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onToggleTest(target);
        }}
      >
        <TestTubeIcon />
      </button>
      <button
        type="button"
        className={classNames(
          'deep-focus-row__support-toggle',
          isSupport && 'deep-focus-row__support-toggle--active',
          supportDisabled && 'deep-focus-row__support-toggle--disabled',
        )}
        aria-label={`Toggle support target for ${row.label}`}
        disabled={supportDisabled}
        onClick={(event) => {
          event.stopPropagation();
          onToggleSupport(target, row);
        }}
      >
        <SupportTargetIcon />
      </button>
      {row.kind === 'directory' ? (
        <span
          className={classNames(
            'deep-focus-row__chevron',
            drillingIndex === index && 'deep-focus-row__chevron--drilling',
          )}
          aria-hidden="true"
        >
          <ChevronRightIcon />
        </span>
      ) : null}
    </div>
  );
}
