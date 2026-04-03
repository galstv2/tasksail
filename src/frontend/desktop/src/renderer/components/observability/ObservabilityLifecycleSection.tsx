import type { WorkflowLifecycleEntry } from '../../../shared/desktopContract';
import { toTitleCase } from '../../utils/toTitleCase';

type ObservabilityLifecycleSectionProps = {
  lifecycle: WorkflowLifecycleEntry[];
};

function stateIcon(state: string): string {
  const s = state.toLowerCase();
  if (s === 'complete' || s === 'completed') return '\u2705';
  if (s === 'active' || s === 'running') return '\u23F3';
  if (s === 'blocked' || s === 'failed') return '\u26A0\uFE0F';
  return '\u2022';
}

function ObservabilityLifecycleSection({ lifecycle }: ObservabilityLifecycleSectionProps): JSX.Element {
  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Workflow Progress</h3>
      <p className="obs-section__desc">Shows where your task is right now — which steps are done, which one is running, and which are still waiting.</p>
      {lifecycle.length === 0 ? (
        <p className="obs-section__empty">No steps have started yet. Progress will appear here once the task begins.</p>
      ) : (
        <div className="obs-timeline">
          {lifecycle.map((entry) => (
            <div key={entry.state} className="obs-timeline__entry">
              <span className="obs-timeline__icon">{stateIcon(entry.state)}</span>
              <div className="obs-timeline__body">
                <strong className="obs-timeline__state">{toTitleCase(entry.state)}</strong>
                <span className="obs-timeline__detail">{entry.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default ObservabilityLifecycleSection;
