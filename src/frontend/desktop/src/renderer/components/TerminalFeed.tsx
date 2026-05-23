import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import type { StreamEvent, StreamRole, TerminalTaskScopeOption } from '../activityStream';
import { classNames } from '../utils/classNames';
import {
  filterActivityStream,
  formatStreamMessage,
  messageEmbedsActorName,
  streamRoleAppearance,
} from '../activityStream';
import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
} from '../../shared/desktopContract';
import { formatLocalTime } from '../utils/localTimestamp';
import ObservabilityLifecycleSection from './observability/ObservabilityLifecycleSection';
import ArtifactReferencesSection from './observability/ArtifactReferencesSection';
import GuardrailSummarySection from './observability/GuardrailSummarySection';
import PlannerBrokerSection from './observability/PlannerBrokerSection';
import AuthorityBoundarySection from './observability/AuthorityBoundarySection';
import EnvironmentPackagingSection from './observability/EnvironmentPackagingSection';
import OperatorQueueSection from './observability/OperatorQueueSection';

export type TerminalFeedProps = {
  activityStream: StreamEvent[];
  replayedEventIds: ReadonlySet<string>;
  taskScopes: TerminalTaskScopeOption[];
  selectedTaskGuid: string | null;
  onSelectTaskScope: (taskGuid: string | null) => Promise<void>;
  observabilitySnapshot: ObservabilitySnapshotResponse | null;
  environmentStatus: EnvironmentStatusResponse | null;
  onDeletePendingItem?: (queueName: string) => Promise<void>;
};

const ROLE_TABS: Array<{ value: StreamRole | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'agent', label: 'Agent' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'planner', label: 'Planner' },
  { value: 'queue', label: 'Queue' },
  { value: 'system', label: 'System' },
  { value: 'workflow', label: 'Workflow' },
];

function formatTime(timestamp: string): string {
  if (timestamp.includes('T')) {
    return formatLocalTime(timestamp) ?? timestamp.trim().slice(0, 8).trim();
  }
  return timestamp.trim().slice(0, 8).trim();
}

function TerminalLine({
  event,
  suppressAnimation,
}: {
  event: StreamEvent;
  suppressAnimation: boolean;
}): JSX.Element {
  const actorEmbeddedInMessage = messageEmbedsActorName(event);
  const displayMessage = stripTaskPrefix(
    actorEmbeddedInMessage || event.actorName ? event.message : formatStreamMessage(event),
    event.taskShortGuid,
  );
  return (
    <div className={classNames(
      'terminal-line',
      event.sessionContext && 'terminal-line--runtime',
      suppressAnimation && 'terminal-line--replay',
    )}>
      <span className="terminal-timestamp">[{formatTime(event.timestamp)}]</span>
      {event.taskShortGuid && (
        <span className="terminal-task">Task [{event.taskShortGuid}]</span>
      )}
      <span className={classNames('terminal-role', `terminal-role--${event.role}`)}>
        [{streamRoleAppearance[event.role].label}]
      </span>
      {event.actorName && !actorEmbeddedInMessage && (
        <span className="terminal-actor">{event.actorName}</span>
      )}
      <span className={classNames(
        'terminal-message',
        event.severity === 'success' && 'terminal-message--success',
        event.severity === 'error' && 'terminal-message--error',
        event.severity === 'warning' && 'terminal-message--warning',
      )}>
        {displayMessage}
      </span>
    </div>
  );
}

function stripTaskPrefix(message: string, taskShortGuid: string | null): string {
  if (!taskShortGuid) {
    return message;
  }
  const prefixWithDash = `Task [${taskShortGuid}] - `;
  if (message.startsWith(prefixWithDash)) {
    return message.slice(prefixWithDash.length);
  }
  const prefix = `Task [${taskShortGuid}] `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

function taskScopePrimaryLabel(scope: TerminalTaskScopeOption): string {
  return scope.title?.trim() || `Task ${scope.taskId}`;
}

function taskScopeSecondaryLabel(scope: TerminalTaskScopeOption): string {
  return `Task [${scope.taskShortGuid}]`;
}

function TerminalFeed({
  activityStream,
  replayedEventIds,
  taskScopes,
  selectedTaskGuid,
  onSelectTaskScope,
  observabilitySnapshot,
  environmentStatus,
  onDeletePendingItem = async () => {},
}: TerminalFeedProps): JSX.Element {
  const [roleFilter, setRoleFilter] = useState<StreamRole | 'all'>('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const taskScopeRef = useRef<HTMLDivElement>(null);
  const taskScopeTriggerRef = useRef<HTMLButtonElement>(null);
  const taskScopeListboxRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const visibleEvents = filterActivityStream(activityStream, roleFilter);
  const selectedTaskScope = taskScopes.find((scope) => scope.taskGuid === selectedTaskGuid);
  const taskScopeOptions = useMemo(
    () => [
      { kind: 'all' as const, id: 'terminal-task-scope-option-all' },
      ...taskScopes.map((scope) => ({
        kind: 'task' as const,
        id: `terminal-task-scope-option-${scope.taskGuid}`,
        scope,
      })),
    ],
    [taskScopes],
  );
  const activeOptionId = menuOpen
    ? taskScopeOptions[Math.min(activeOptionIndex, taskScopeOptions.length - 1)]?.id
    : undefined;

  const selectedOptionIndex = useCallback(() => {
    if (selectedTaskGuid === null) {
      return 0;
    }
    const index = taskScopeOptions.findIndex((option) => (
      option.kind === 'task' && option.scope.taskGuid === selectedTaskGuid
    ));
    return index >= 0 ? index : 0;
  }, [selectedTaskGuid, taskScopeOptions]);

  const closeTaskScopeMenu = useCallback(() => {
    setMenuOpen(false);
    taskScopeTriggerRef.current?.focus();
  }, []);

  const dismissTaskScopeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  const openTaskScopeMenu = useCallback(() => {
    setActiveOptionIndex(selectedOptionIndex());
    setMenuOpen(true);
  }, [selectedOptionIndex]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleEvents.length, autoScroll]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    taskScopeListboxRef.current?.focus();
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    function handleMouseDown(event: globalThis.MouseEvent): void {
      const target = event.target as Node;
      if (taskScopeRef.current?.contains(target)) {
        return;
      }
      dismissTaskScopeMenu();
    }
    function handleBlur(): void {
      dismissTaskScopeMenu();
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('blur', handleBlur);
    };
  }, [menuOpen, closeTaskScopeMenu]);

  function handleScroll(): void {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  function scrollToBottom(): void {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }

  function selectTaskScopeOption(index: number): void {
    const safeIndex = Math.min(Math.max(index, 0), taskScopeOptions.length - 1);
    const option = taskScopeOptions[safeIndex];
    if (!option) {
      return;
    }
    closeTaskScopeMenu();
    if (option.kind === 'all') {
      void onSelectTaskScope(null);
      return;
    }
    void onSelectTaskScope(option.scope.taskGuid);
  }

  function handleTaskScopeTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTaskScopeMenu();
    }
  }

  function handleTaskScopeListboxKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const lastIndex = taskScopeOptions.length - 1;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveOptionIndex((index) => (index >= lastIndex ? 0 : index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveOptionIndex((index) => (index <= 0 ? lastIndex : index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveOptionIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveOptionIndex(lastIndex);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectTaskScopeOption(activeOptionIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeTaskScopeMenu();
    } else if (event.key === 'Tab') {
      // Tab and outside dismissals should not restore focus to the trigger;
      // they are explicit attempts to leave the menu.
      dismissTaskScopeMenu();
    }
  }

  return (
    <div className="terminal-feed" aria-label="Terminal feed">
      <div className="terminal-feed__chrome">
        <span className="terminal-feed__title">Terminal</span>
        <div className="terminal-feed__tabs" role="tablist" aria-label="Role filter">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={roleFilter === tab.value}
              className={classNames('terminal-tab', roleFilter === tab.value && 'terminal-tab--active')}
              onClick={() => setRoleFilter(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={classNames(
          'terminal-feed__task-scope',
          selectedTaskGuid !== null && 'terminal-feed__task-scope--active',
        )} ref={taskScopeRef}>
          <span>Task</span>
          <div className="terminal-feed__task-menu">
            <button
              ref={taskScopeTriggerRef}
              type="button"
              className={classNames(
                'terminal-feed__task-menu-trigger',
                menuOpen && 'terminal-feed__task-menu-trigger--open',
              )}
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? 'terminal-task-scope-listbox' : undefined}
              aria-label="Terminal task scope"
              onClick={() => {
                if (menuOpen) {
                  closeTaskScopeMenu();
                } else {
                  openTaskScopeMenu();
                }
              }}
              onKeyDown={handleTaskScopeTriggerKeyDown}
            >
              <span className="terminal-feed__task-menu-trigger-label">
                {selectedTaskScope ? (
                  <>
                    <span className="terminal-feed__task-menu-option__primary">
                      {taskScopePrimaryLabel(selectedTaskScope)}
                    </span>
                    <span className="terminal-feed__task-menu-option__marker">
                      {taskScopeSecondaryLabel(selectedTaskScope)}
                    </span>
                  </>
                ) : (
                  <span className="terminal-feed__task-menu-option__primary">All Tasks</span>
                )}
              </span>
              <svg className="terminal-feed__task-menu-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {menuOpen && (
              <div
                ref={taskScopeListboxRef}
                id="terminal-task-scope-listbox"
                role="listbox"
                aria-label="Terminal task scope"
                aria-activedescendant={activeOptionId}
                tabIndex={0}
                className="terminal-feed__task-menu-listbox"
                onKeyDown={handleTaskScopeListboxKeyDown}
              >
                {taskScopeOptions.map((option, index) => {
                  const isSelected = option.kind === 'all'
                    ? selectedTaskGuid === null
                    : selectedTaskGuid === option.scope.taskGuid;
                  return (
                    <button
                      key={option.id}
                      id={option.id}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={isSelected}
                      className={classNames(
                        'terminal-feed__task-menu-option',
                        isSelected && 'terminal-feed__task-menu-option--selected',
                        index === activeOptionIndex && 'terminal-feed__task-menu-option--active',
                      )}
                      onMouseEnter={() => setActiveOptionIndex(index)}
                      onClick={() => selectTaskScopeOption(index)}
                    >
                      {option.kind === 'all' ? (
                        <span className="terminal-feed__task-menu-option__primary">All Tasks</span>
                      ) : (
                        <>
                          <span className="terminal-feed__task-menu-option__primary">
                            {taskScopePrimaryLabel(option.scope)}
                          </span>
                          <span className="terminal-feed__task-menu-option__marker">
                            {taskScopeSecondaryLabel(option.scope)}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className="terminal-feed__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {visibleEvents.map((event) => (
          <TerminalLine
            key={event.id}
            event={event}
            suppressAnimation={replayedEventIds.has(event.id)}
          />
        ))}
        <span className="terminal-cursor" aria-hidden="true" />
      </div>

      {!autoScroll && (
        <button
          type="button"
          className="terminal-feed__scroll-btn"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          &darr; Bottom
        </button>
      )}

      <div className="observability-drawer">
        <button
          type="button"
          className="observability-drawer__toggle"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((prev) => !prev)}
        >
          <span>System Details</span>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" style={{ transform: drawerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease' }}>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {drawerOpen && observabilitySnapshot && (
          <div className="observability-drawer__content" aria-label="System details">
            <OperatorQueueSection
              operatorStatus={observabilitySnapshot.operatorStatus ?? { activeTasks: [], activeTaskId: null }}
              pendingQueueItems={observabilitySnapshot.pendingQueueItems ?? []}
              errorItemsCount={observabilitySnapshot.errorItemsCount}
              recoveryState={observabilitySnapshot.recoveryState ?? null}
              onDeletePendingItem={onDeletePendingItem}
            />
            <ObservabilityLifecycleSection lifecycle={observabilitySnapshot.lifecycle} />
            <ArtifactReferencesSection artifactReferences={observabilitySnapshot.artifactReferences} />
            <GuardrailSummarySection
              guardrailSummary={observabilitySnapshot.guardrailSummary}
              guardrails={observabilitySnapshot.guardrails ?? []}
            />
            <PlannerBrokerSection plannerBroker={observabilitySnapshot.plannerBroker} />
            <AuthorityBoundarySection
              message={observabilitySnapshot.message}
              policyBoundary={observabilitySnapshot.policyBoundary}
            />
            <EnvironmentPackagingSection environmentStatus={environmentStatus} />
          </div>
        )}
      </div>
    </div>
  );
}

export default TerminalFeed;
