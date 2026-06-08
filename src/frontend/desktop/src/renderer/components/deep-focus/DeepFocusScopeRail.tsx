import { useEffect, useMemo, useRef, useState } from 'react';

import type { ContextPackPrimaryFocusTarget } from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';
import { isCursorEqual, primaryIdentityKey, type EditScopeCursor } from './SidebarDeepFocusUtils';
import { labelPrimaryForDisplay, primariesSpanMultipleRepos } from './sidebarDeepFocusSelectors';

export type DeepFocusScopeRailProps = {
  primaries: ContextPackPrimaryFocusTarget[];
  cursor: EditScopeCursor;
  draftTopLevel?: { label: string; rootPath: string } | null;
  exitingPrimaryKey: string | null;
  focusRequest: EditScopeCursor | null;
  onSelectCursor: (cursor: EditScopeCursor) => void;
  onFocusRequestHandled: () => void;
};

function GlobeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M2.8 8h10.4M8 2.6c1.35 1.35 2.05 3.15 2.05 5.4S9.35 12.05 8 13.4M8 2.6C6.65 3.95 5.95 5.75 5.95 8S6.65 12.05 8 13.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function truncatePrimaryLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function cursorDomKey(cursor: EditScopeCursor, primaries: ContextPackPrimaryFocusTarget[]): string {
  if (cursor.kind === 'global') return 'global';
  const primary = primaries[cursor.index];
  return primary ? `primary:${cursor.index}:${primaryIdentityKey(primary)}` : 'global';
}

export function DeepFocusScopeRail({
  primaries,
  cursor,
  draftTopLevel,
  exitingPrimaryKey,
  focusRequest,
  onSelectCursor,
  onFocusRequestHandled,
}: DeepFocusScopeRailProps): JSX.Element {
  const primaryKeys = useMemo(
    () => primaries.map((primary) => primaryIdentityKey(primary)),
    [primaries],
  );
  const previousKeysRef = useRef<string[] | null>(null);
  const enteringTimersRef = useRef<Set<number>>(new Set());
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [enteringKeys, setEnteringKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const previousKeys = previousKeysRef.current;
    previousKeysRef.current = primaryKeys;
    if (previousKeys === null) return undefined;

    const previous = new Set(previousKeys);
    const nextEntering = primaryKeys.filter((key) => !previous.has(key));
    if (nextEntering.length === 0) return undefined;

    setEnteringKeys((current) => new Set([...current, ...nextEntering]));
    const timer = window.setTimeout(() => {
      enteringTimersRef.current.delete(timer);
      setEnteringKeys((current) => {
        const next = new Set(current);
        nextEntering.forEach((key) => next.delete(key));
        return next;
      });
    }, 220);
    enteringTimersRef.current.add(timer);

    return undefined;
  }, [primaryKeys]);

  useEffect(() => () => {
    enteringTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    enteringTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const key = cursorDomKey(focusRequest, primaries);
    const button = buttonRefs.current[key];
    if (!button) {
      // Target capsule hasn't mounted yet (e.g. mid-enter-animation).
      // Leave the request in place; a later render after mount retries.
      return;
    }
    button.focus();
    onFocusRequestHandled();
  }, [focusRequest, onFocusRequestHandled, primaries]);

  const activeCursor = cursor.kind === 'primary' && !primaries[cursor.index]
    ? { kind: 'global' as const }
    : cursor;
  const spansRepos = useMemo(() => primariesSpanMultipleRepos(primaries), [primaries]);

  return (
    <nav className="deep-focus-scope-rail" aria-label="Deep Focus scopes">
      <div className="deep-focus-scope-rail__scroller">
        <button
          type="button"
          ref={(element) => { buttonRefs.current.global = element; }}
          className={classNames(
            'deep-focus-scope-rail__capsule',
            'deep-focus-scope-rail__capsule--global',
            isCursorEqual(activeCursor, { kind: 'global' }) && 'deep-focus-scope-rail__capsule--active',
          )}
          aria-pressed={isCursorEqual(activeCursor, { kind: 'global' })}
          aria-label="All primaries"
          title="All primaries"
          onClick={() => onSelectCursor({ kind: 'global' })}
        >
          <span className="deep-focus-scope-rail__icon"><GlobeIcon /></span>
          <span>All primaries</span>
        </button>

        {primaries.length === 0 ? (
          <span className="deep-focus-scope-rail__empty">No primary targets yet</span>
        ) : primaries.map((primary, index) => {
          const key = primaryIdentityKey(primary);
          const cursorForPrimary: EditScopeCursor = { kind: 'primary', index };
          const label = labelPrimaryForDisplay(primary, spansRepos, draftTopLevel ?? null);
          const domKey = cursorDomKey(cursorForPrimary, primaries);
          const isActive = isCursorEqual(activeCursor, cursorForPrimary);
          return (
            <button
              key={key}
              type="button"
              ref={(element) => { buttonRefs.current[domKey] = element; }}
              className={classNames(
                'deep-focus-scope-rail__capsule',
                isActive && 'deep-focus-scope-rail__capsule--active',
                enteringKeys.has(key) && 'deep-focus-scope-rail__capsule--entering',
                exitingPrimaryKey === key && 'deep-focus-scope-rail__capsule--removing',
              )}
              aria-pressed={isActive}
              aria-label={`Primary Target: ${label}`}
              onClick={() => onSelectCursor(cursorForPrimary)}
              title={`Primary Target - ${label}`}
            >
              <span className="deep-focus-scope-rail__label">{truncatePrimaryLabel(label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
