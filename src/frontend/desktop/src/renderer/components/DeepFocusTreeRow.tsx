import type { ContextPackFocusTargetKind } from '../../shared/desktopContract';
import { classNames } from '../utils/classNames';
import { DeepFocusInlineCommands } from './DeepFocusInlineCommands';
import { TestGlyph } from './DeepFocusGlyphs';
import { isTestClassifiedRow, type TreeRowBadge } from './SidebarDeepFocusUtils';
import type { PopoverAction, ScopedRoleAction } from './SidebarDeepFocusUtils';

const INDENT_FULL_STEP_PX = 16;
const INDENT_COMPRESSED_STEP_PX = 6;
const INDENT_FULL_STEP_LEVELS = 6;
const INDENT_MAX_PX = 168;

export function computeRowIndentPx(depth: number): number {
  const fullLevels = Math.min(depth, INDENT_FULL_STEP_LEVELS);
  const compressedLevels = Math.max(0, depth - INDENT_FULL_STEP_LEVELS);
  const indent =
    fullLevels * INDENT_FULL_STEP_PX + compressedLevels * INDENT_COMPRESSED_STEP_PX;
  return Math.min(indent, INDENT_MAX_PX);
}

export type FocusRole = 'primary' | 'test' | 'support';

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
  systemLayer: string | null;
  isTest?: boolean;
  artifactType?: string;
  pathKind?: string;
  depth: number;
};

type DeepFocusTreeRowProps = {
  row: TreeRowData;
  index: number;
  focusedIndex: number;
  focusedKey: string | null;
  depth: number;
  expanded: boolean;
  badges: TreeRowBadge[];
  selected: boolean;
  rowRef: (element: HTMLDivElement | null) => void;
  onFocus: (index: number, id: string) => void;
  onSelect: (row: TreeRowData, index: number) => void;
  onToggleExpand: (rowId: string) => void;
  inlineCommands?: {
    actions: PopoverAction[];
    onAction: (action: ScopedRoleAction) => void;
  };
  isSupportContextParent?: boolean;
  supportContextPrimaryLabel?: string;
  ghostSupportCandidate?: { primaryIndex: number; candidateLabel: string; primaryLabel: string };
};

function badgeAccessibleText(badge: TreeRowBadge): string | null {
  if (badge.kind === 'primary') return 'Primary Target';
  if (badge.kind === 'test') return 'Test';
  if (badge.kind === 'support') return 'Support';
  return null;
}

function FolderTreeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M2.7 5.2a1.2 1.2 0 0 1 1.2-1.2h2.2l1.15 1.35h4.85a1.2 1.2 0 0 1 1.2 1.2v4.95a1.5 1.5 0 0 1-1.5 1.5H4.2a1.5 1.5 0 0 1-1.5-1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileNodeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4 2.5h5.2L12 5.3v8.2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 2.5V5a.8.8 0 0 0 .8.8h2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 8.2h5.6M5.2 10.4h4"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.25"
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
  depth,
  expanded,
  badges,
  selected,
  rowRef,
  onFocus,
  onSelect,
  onToggleExpand,
  inlineCommands,
  isSupportContextParent = false,
  supportContextPrimaryLabel,
  ghostSupportCandidate,
}: DeepFocusTreeRowProps): JSX.Element {
  const isTestLayer = !ghostSupportCandidate && isTestClassifiedRow({
    kind: row.kind,
    systemLayer: row.systemLayer,
    label: row.label,
    isTest: row.isTest,
    artifactType: row.artifactType,
    pathKind: row.pathKind,
  });
  const isPrimary = badges.some((badge) => badge.kind === 'primary');
  const isTest = badges.some((badge) => badge.kind === 'test');
  const isSupport = badges.some((badge) => badge.kind === 'support');

  return (
    <div className="deep-focus-row-container">
      <div
        ref={rowRef}
        role="button"
        tabIndex={focusedIndex === index ? 0 : -1}
        className={classNames(
          'deep-focus-row',
          row.kind === 'directory' ? 'deep-focus-row--directory' : 'deep-focus-row--file',
          ghostSupportCandidate && 'deep-focus-row--ghost-support',
          isPrimary && 'deep-focus-row--selected',
          !isPrimary && isTest && 'deep-focus-row--test-selected',
          isPrimary && isTest && 'deep-focus-row--primary-and-test',
          isSupport && 'deep-focus-row--support-selected',
          isTestLayer && badges.length === 0 && 'deep-focus-row--test-layer',
          selected && 'deep-focus-row--command-selected',
        )}
        style={{ paddingLeft: `calc(12px + ${computeRowIndentPx(depth)}px)` }}
        onFocus={() => { onFocus(index, row.id); }}
        onClick={() => { onSelect(row, index); }}
        data-focused={focusedKey === row.id ? 'true' : undefined}
        data-row-index={index}
        aria-label={ghostSupportCandidate
          ? `Include ${ghostSupportCandidate.candidateLabel} as support for ${ghostSupportCandidate.primaryLabel}`
          : undefined}
      >
        <span className="deep-focus-row__icon" aria-hidden="true">
          {ghostSupportCandidate ? '+' : row.kind === 'directory' ? <FolderTreeIcon /> : <FileNodeIcon />}
        </span>
        <span className="deep-focus-row__label">
          <span className="deep-focus-row__title-row">
            <span className="deep-focus-row__name">
              {ghostSupportCandidate
                ? `Include ${ghostSupportCandidate.candidateLabel} as support for ${ghostSupportCandidate.primaryLabel}`
                : row.label}
            </span>
            {badges.map((badge) => (
              <span
                key={`${badge.kind}:${badge.label}`}
                className={classNames('status-chip', 'status-chip--xs', 'deep-focus-row__badge')}
                aria-label={badge.ariaLabel}
              >
                {badge.label}
                <span className="deep-focus-visually-hidden">{badgeAccessibleText(badge)}</span>
              </span>
            ))}
            {isTestLayer ? (
              <span className="deep-focus-row__test-glyph">
                <TestGlyph />
                <span className="deep-focus-visually-hidden">Test target</span>
              </span>
            ) : null}
            {isSupportContextParent && supportContextPrimaryLabel ? (
              <span className="deep-focus-row__support-context-label">
                Support for {supportContextPrimaryLabel}
              </span>
            ) : null}
          </span>
          {!ghostSupportCandidate && row.displayPath && row.displayPath !== row.label ? (
            <span className="deep-focus-row__path" title={row.displayPath}>
              {row.displayPath}
            </span>
          ) : null}
        </span>
        {row.kind === 'directory' && row.hasChildren ? (
          <span
            className={classNames(
              'deep-focus-row__chevron',
              expanded && 'deep-focus-row__chevron--expanded',
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleExpand(row.id);
            }}
            aria-hidden="true"
          >
            <ChevronRightIcon />
          </span>
        ) : null}
      </div>
      {selected && inlineCommands ? (
        <DeepFocusInlineCommands
          row={row}
          actions={inlineCommands.actions}
          onAction={inlineCommands.onAction}
        />
      ) : null}
    </div>
  );
}
