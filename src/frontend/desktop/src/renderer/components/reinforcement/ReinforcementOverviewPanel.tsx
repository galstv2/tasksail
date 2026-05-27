import type { ReinforcementOverviewData } from '../../../shared/desktopContract';
import { formatNumber } from '../../utils/formatNumber';

type ReinforcementOverviewPanelProps = {
  hasActiveContextPack: boolean;
  overview: ReinforcementOverviewData | null;
  loading: boolean;
  error: string | null;
};

function ReinforcementOverviewPanel({
  hasActiveContextPack,
  overview,
  loading,
  error,
}: ReinforcementOverviewPanelProps): JSX.Element {
  if (!hasActiveContextPack) {
    return (
      <div className="overview-panel" data-testid="overview-panel">
        <p className="overview-panel__empty" data-testid="overview-empty">
          Activate a context pack to view reinforcement state.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="overview-panel" data-testid="overview-panel">
        <p className="overview-panel__error" data-testid="overview-error">{error}</p>
      </div>
    );
  }

  if (loading || !overview) {
    return (
      <div className="overview-panel" data-testid="overview-panel">
        <p className="overview-panel__loading">Loading overview...</p>
      </div>
    );
  }

  return (
    <div className="overview-panel" data-testid="overview-panel">
      <p className="overview-panel__source-label" data-testid="overview-summary-source">
        Reinforcement totals from repo-global task ledger
      </p>
      <div className="overview-panel__summary">
        <div className="overview-stat" data-testid="overview-total-tasks">
          <span className="overview-stat__value">{formatNumber(overview.totalTasks)}</span>
          <span className="overview-stat__label">Tasks</span>
        </div>
        <div className="overview-stat" data-testid="overview-total-reward">
          <span className="overview-stat__value">{formatNumber(overview.totalReward)}</span>
          <span className="overview-stat__label">Total Reward</span>
        </div>
        <div className="overview-stat" data-testid="overview-streak">
          <span className="overview-stat__value">
            {overview.streakProgress}/{overview.streakThreshold}
          </span>
          <span className="overview-stat__label">Streak</span>
        </div>
        <div className="overview-stat" data-testid="overview-unrewarded">
          <span className="overview-stat__value">{formatNumber(overview.unrewardedCount)}</span>
          <span className="overview-stat__label">Unrewarded</span>
        </div>
      </div>

      {overview.agents.length > 0 && (
        <div className="overview-panel__agents" data-testid="overview-agents">
          <h3 className="overview-panel__section-title">
            Per-Agent Reward Totals
            <span className="overview-panel__source-label">
              global per-agent reward memory
            </span>
          </h3>
          <div className="overview-agent-grid">
            {overview.agents.map((agent) => (
              <div
                key={agent.agentId}
                className="overview-agent-card"
                data-testid={`agent-card-${agent.agentId}`}
              >
                <div className="overview-agent-card__header">
                  <span className="overview-agent-card__name">{agent.role}</span>
                  <span className="overview-agent-card__multiplier">{agent.multiplier.toFixed(2)}x</span>
                </div>
                <div className="overview-agent-card__reward">
                  {formatNumber(agent.lifetimeReward)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {overview.lastSettlementId && (
        <p className="overview-panel__settlement" data-testid="overview-last-settlement">
          Last settlement{' '}
          <span className="overview-panel__settlement-id">{overview.lastSettlementId}</span>
        </p>
      )}
    </div>
  );
}

export default ReinforcementOverviewPanel;
