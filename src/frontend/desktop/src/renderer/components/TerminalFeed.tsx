import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { StreamEvent, StreamRole, TerminalTaskScopeOption } from '../activityStream';
import { classNames } from '../utils/classNames';
import TerminalSelectMenu, { type TerminalSelectMenuOption } from './TerminalSelectMenu';
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
  onClearTerminal?: () => void;
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

// Sentinel option value for the "All Tasks" entry, mapped back to a null scope.
const TASK_SCOPE_ALL_VALUE = '';

function TerminalFeed({
  activityStream,
  replayedEventIds,
  taskScopes,
  selectedTaskGuid,
  onSelectTaskScope,
  observabilitySnapshot,
  environmentStatus,
  onDeletePendingItem = async () => {},
  onClearTerminal = () => {},
}: TerminalFeedProps): JSX.Element {
  const [roleFilter, setRoleFilter] = useState<StreamRole | 'all'>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const visibleEvents = filterActivityStream(activityStream, roleFilter);
  const taskScopeOptions = useMemo<TerminalSelectMenuOption[]>(
    () => [
      { value: TASK_SCOPE_ALL_VALUE, id: 'terminal-task-scope-option-all', primaryLabel: 'All Tasks' },
      ...taskScopes.map((scope) => ({
        value: scope.taskGuid,
        id: `terminal-task-scope-option-${scope.taskGuid}`,
        primaryLabel: taskScopePrimaryLabel(scope),
        secondaryLabel: taskScopeSecondaryLabel(scope),
      })),
    ],
    [taskScopes],
  );

  const handleSelectTaskScope = useCallback(
    (value: string) => {
      void onSelectTaskScope(value === TASK_SCOPE_ALL_VALUE ? null : value);
    },
    [onSelectTaskScope],
  );

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleEvents.length, autoScroll]);

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
        )}>
          <span>Task</span>
          <TerminalSelectMenu
            options={taskScopeOptions}
            selectedValue={selectedTaskGuid ?? TASK_SCOPE_ALL_VALUE}
            onSelect={handleSelectTaskScope}
            ariaLabel="Terminal task scope"
            listboxId="terminal-task-scope-listbox"
          />
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
        <div className="observability-drawer__bar">
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
          <button
            type="button"
            className="observability-drawer__clear"
            onClick={onClearTerminal}
            disabled={activityStream.length === 0}
            aria-label="Clear terminal"
            title="Clear terminal"
          >
            <span className="observability-drawer__clear-glyph" aria-hidden="true">⌫</span>
            <span>Clear</span>
          </button>
        </div>
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
