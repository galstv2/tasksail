import type {
  GuardrailObservation,
  GuardrailSummary,
} from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

type GuardrailSummarySectionProps = {
  guardrailSummary?: GuardrailSummary;
  guardrails: GuardrailObservation[];
};

function overallLabel(status: string): { text: string; className: string } {
  switch (status) {
    case 'critical':
      return { text: 'Issues found', className: 'obs-pmdge--error' };
    case 'attention':
      return { text: 'Needs review', className: 'obs-pmdge--warn' };
    case 'healthy':
      return { text: 'All clear', className: 'obs-pmdge--ok' };
    default:
      return { text: 'Not checked yet', className: 'obs-pmdge--idle' };
  }
}

function humanize(value: string): string {
  return value.replace(/-/g, ' ');
}

function GuardrailSummarySection({
  guardrailSummary,
  guardrails,
}: GuardrailSummarySectionProps): JSX.Element {
  const summary = guardrailSummary ?? {
    status: 'idle',
    summary: 'No checks have run yet. They will appear once agents start working.',
    observedReceiptCount: 0,
    allowedCount: 0,
    deniedCount: 0,
    internalBypassCount: 0,
    malformedCount: 0,
    violationCount: 0,
  };

  const pmdge = overallLabel(summary.status);

  return (
    <section className="obs-section">
      <div className="obs-section__header-row">
        <h3 className="obs-section__title">Safety Checks</h3>
        <span className={classNames('obs-pmdge', pmdge.className)}>{pmdge.text}</span>
      </div>
      <p className="obs-section__desc">
        Automatic checks that make sure each agent only does what it is allowed to do — like a security guard watching each step.
      </p>
      <p className="obs-section__body">{summary.summary}</p>

      {summary.observedReceiptCount > 0 && (
        <div className="obs-stat-row">
          <span className="obs-stat">{summary.observedReceiptCount} checked</span>
          {summary.allowedCount > 0 && <span className="obs-stat obs-stat--ok">{summary.allowedCount} passed</span>}
          {summary.deniedCount > 0 && <span className="obs-stat obs-stat--error">{summary.deniedCount} denied</span>}
          {summary.violationCount > 0 && <span className="obs-stat obs-stat--error">{summary.violationCount} violations</span>}
          {summary.internalBypassCount > 0 && <span className="obs-stat obs-stat--warn">{summary.internalBypassCount} bypassed</span>}
          {summary.malformedCount > 0 && <span className="obs-stat obs-stat--warn">{summary.malformedCount} malformed</span>}
        </div>
      )}

      {guardrails.length > 0 && (
        <div className="obs-file-list">
          {guardrails.map((guardrail) => (
            <div key={guardrail.receiptPath} className="obs-file-row">
              <div className="obs-file-row__header">
                <span className="obs-file-row__name">{guardrail.agentLabel}</span>
                <span className={classNames('obs-file-row__status', `obs-file-row__status--${guardrail.severity === 'error' ? 'missing' : guardrail.severity === 'warning' ? 'warn' : 'ok'}`)}>
                  {humanize(guardrail.status)}
                </span>
              </div>
              <span className="obs-file-row__detail">{guardrail.summary}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default GuardrailSummarySection;
