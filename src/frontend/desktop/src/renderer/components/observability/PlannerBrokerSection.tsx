import type { PlannerBrokerObservation } from '../../../shared/desktopContract';

type PlannerBrokerSectionProps = {
  plannerBroker?: PlannerBrokerObservation | null;
};

function humanizeTurnSource(value: PlannerBrokerObservation['lastTurnSource']): string {
  switch (value) {
    case 'interactive-bootstrap':
      return 'Interactive bootstrap';
    case 'new-session':
      return 'New session';
    case 'resumed-session':
      return 'Resumed session';
    default:
      return 'None';
  }
}

function humanizeTurnOutcome(value: PlannerBrokerObservation['lastTurnOutcome']): string {
  switch (value) {
    case 'running':
      return 'Running';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    default:
      return 'Idle';
  }
}

function PlannerBrokerSection({ plannerBroker }: PlannerBrokerSectionProps): JSX.Element {
  if (!plannerBroker) {
    return (
      <section className="obs-section">
        <h3 className="obs-section__title">Planner Broker</h3>
        <p className="obs-section__desc">
          The planning assistant has not been used yet. Start a planning session to see its status here.
        </p>
      </section>
    );
  }

  const contentStatus = plannerBroker.lastTurnHadContent ? 'content observed' : 'no content observed';

  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Planner Broker</h3>
      <p className="obs-section__desc">
        Live status of the planning assistant — whether it is idle, thinking, or finished, and how many conversations have happened.
      </p>
      <p className="obs-section__body">
        Status: {plannerBroker.brokerStatus}. Queue depth: {plannerBroker.queuedTurnCount}. Turns run:{' '}
        {plannerBroker.turnCount}.
      </p>
      <p className="obs-section__body">
        Last turn: {humanizeTurnSource(plannerBroker.lastTurnSource)} /{' '}
        {humanizeTurnOutcome(plannerBroker.lastTurnOutcome)} / {contentStatus}.
      </p>
      {plannerBroker.sessionId && (
        <p className="obs-section__body">
          Active session: {plannerBroker.sessionId}
          {plannerBroker.activeTurnId ? ` (${plannerBroker.activeTurnId})` : ''}
        </p>
      )}
      {plannerBroker.error && <p className="obs-section__body">{plannerBroker.error}</p>}
    </section>
  );
}

export default PlannerBrokerSection;
