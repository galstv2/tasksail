import { useCallback, useState } from 'react';

import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';
import { formatNumber } from '../../utils/formatNumber';

type TaskLedgerTableProps = {
  hasActiveContextPack: boolean;
  tasks: ReinforcementTaskEntry[];
  availableYears: string[];
  selectedYear: string | null;
  loading: boolean;
  error: string | null;
  onSelectYear: (year: string | null) => void;
};

function TaskLedgerTable({
  hasActiveContextPack,
  tasks,
  availableYears,
  selectedYear,
  loading,
  error,
  onSelectYear,
}: TaskLedgerTableProps): JSX.Element {
  const [search, setSearch] = useState('');

  const onSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
    [],
  );

  if (!hasActiveContextPack) {
    return (
      <div className="ledger-table" data-testid="ledger-table">
        <p className="ledger-table__empty" data-testid="ledger-empty">
          Activate a context pack to view task history.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ledger-table" data-testid="ledger-table">
        <p className="ledger-table__error" data-testid="ledger-error">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ledger-table" data-testid="ledger-table">
        <p className="ledger-table__loading">Loading tasks...</p>
      </div>
    );
  }

  const filtered = search.trim()
    ? tasks.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.taskId.toLowerCase().includes(search.toLowerCase()),
      )
    : tasks;

  return (
    <div className="ledger-table" data-testid="ledger-table">
      <div className="ledger-table__controls">
        <input
          type="text"
          className="ledger-table__search"
          placeholder="Search tasks..."
          value={search}
          onChange={onSearchChange}
          data-testid="ledger-search"
        />
        {availableYears.length > 1 && (
          <select
            className="ledger-table__year-select"
            value={selectedYear ?? ''}
            onChange={(e) => onSelectYear(e.target.value || null)}
            data-testid="ledger-year-select"
          >
            <option value="">All years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      <p className="ledger-table__source-label" data-testid="ledger-source">
        Task history from active context pack archive
      </p>

      {filtered.length === 0 ? (
        <p className="ledger-table__empty" data-testid="ledger-no-results">
          {search.trim() ? 'No matching tasks.' : 'No archived tasks found.'}
        </p>
      ) : (
        <table className="ledger-table__table" data-testid="ledger-rows">
          <thead>
            <tr>
              <th>Task</th>
              <th>Difficulty</th>
              <th>Reward</th>
              <th>Status</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((task) => (
              <tr key={task.taskId} data-testid={`ledger-row-${task.taskId}`}>
                <td className="ledger-table__task-title" title={task.taskId}>
                  {task.title}
                </td>
                <td>{task.difficulty}</td>
                <td>{formatNumber(task.effectiveReward)}</td>
                <td>
                  <span className={`status-chip status-chip--sm status-chip--${task.settlementStatus === 'rewarded' ? 'active' : 'idle'}`}>
                    {task.settlementStatus}
                  </span>
                </td>
                <td>{task.qualityOutcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default TaskLedgerTable;
