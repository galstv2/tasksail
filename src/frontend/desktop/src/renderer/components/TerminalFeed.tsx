import { useEffect, useRef, useState } from 'react';

import type { StreamEvent, StreamRole } from '../activityStream';
import { classNames } from '../utils/classNames';
import {
  filterActivityStream,
  formatStreamMessage,
  streamRoleAppearance,
} from '../activityStream';
import type {
  EnvironmentStatusResponse,
  ObservabilitySnapshotResponse,
} from '../../shared/desktopContract';
import ObservabilityLifecycleSection from './observability/ObservabilityLifecycleSection';
import ArtifactReferencesSection from './observability/ArtifactReferencesSection';
import GuardrailSummarySection from './observability/GuardrailSummarySection';
import PlannerBrokerSection from './observability/PlannerBrokerSection';
import AuthorityBoundarySection from './observability/AuthorityBoundarySection';
import EnvironmentPackagingSection from './observability/EnvironmentPackagingSection';
import OperatorQueueSection from './observability/OperatorQueueSection';

export type TerminalFeedProps = {
  activityStream: StreamEvent[];
  observabilitySnapshot: ObservabilitySnapshotResponse | null;
  environmentStatus: EnvironmentStatusResponse | null;
  onDeletePendingItem?: (queueName: string) => Promise<void>;
};

const ROLE_TABS: Array<{ value: StreamRole | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'planner', label: 'Planner' },
  { value: 'queue', label: 'Queue' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'system', label: 'System' },
];

function formatTime(timestamp: string): string {
  if (timestamp.includes('T')) {
    const timePart = timestamp.split('T')[1];
    return timePart ? timePart.slice(0, 8) : timestamp.slice(0, 8);
  }
  return timestamp.slice(0, 8);
}

function TerminalLine({ event }: { event: StreamEvent }): JSX.Element {
  return (
    <div className={classNames('terminal-line', event.sessionContext && 'terminal-line--runtime')}>
      <span className="terminal-timestamp">[{formatTime(event.timestamp)}]</span>
      <span className={classNames('terminal-role', `terminal-role--${event.role}`)}>
        [{streamRoleAppearance[event.role].label}]
      </span>
      {event.actorName && (
        <span className="terminal-actor">{event.actorName}</span>
      )}
      <span className={classNames(
        'terminal-message',
        event.severity === 'success' && 'terminal-message--success',
        event.severity === 'error' && 'terminal-message--error',
        event.severity === 'warning' && 'terminal-message--warning',
      )}>
        {event.actorName ? event.message : formatStreamMessage(event)}
      </span>
    </div>
  );
}

function TerminalFeed({
  activityStream,
  observabilitySnapshot,
  environmentStatus,
  onDeletePendingItem = async () => {},
}: TerminalFeedProps): JSX.Element {
  const [roleFilter, setRoleFilter] = useState<StreamRole | 'all'>('all');
  const [highPriorityOnly, setHighPriorityOnly] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const visibleEvents = filterActivityStream(activityStream, roleFilter, highPriorityOnly);

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
        <label className="terminal-feed__severity-toggle">
          <input
            type="checkbox"
            checked={highPriorityOnly}
            onChange={(e) => setHighPriorityOnly(e.target.checked)}
          />
          <span>Warnings &amp; errors only</span>
        </label>
      </div>

      <div
        className="terminal-feed__scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {visibleEvents.map((event) => (
          <TerminalLine key={event.id} event={event} />
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
