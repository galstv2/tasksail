import type { ReinforcementTaskEntry } from '../../../shared/desktopContract';

type TaskPickerProps = {
  tasks: ReinforcementTaskEntry[];
  availableYears: string[];
  selectedYear: string | null;
  selectedTaskId: string;
  loading: boolean;
  onSelectYear: (year: string | null) => void;
  onSelectTask: (taskId: string) => void;
  onOpenTask?: (taskId: string) => void;
};

function TaskPicker({
  tasks,
  availableYears,
  selectedYear,
  selectedTaskId,
  loading,
  onSelectYear,
  onSelectTask,
  onOpenTask,
}: TaskPickerProps): JSX.Element {
  return (
    <div className="task-picker" data-testid="task-picker">
      <div className="task-picker__header">
        <label className="task-picker__label">Task</label>
        {availableYears.length > 1 && (
          <select
            className="task-picker__year-select"
            value={selectedYear ?? ''}
            onChange={(e) => onSelectYear(e.target.value || null)}
            data-testid="task-picker-year-select"
          >
            <option value="">All years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <p className="task-picker__loading">Loading tasks...</p>
      ) : tasks.length === 0 ? (
        <p className="task-picker__empty" data-testid="task-picker-empty">
          No archived tasks found.
        </p>
      ) : (
        <ul className="task-picker__list" data-testid="task-picker-list">
          {tasks.map((task) => (
            <li key={task.taskId}>
              <button
                type="button"
                className={`task-picker__item ${task.taskId === selectedTaskId ? 'task-picker__item--selected' : ''}`}
                onClick={() => onSelectTask(task.taskId)}
                onDoubleClick={() => onOpenTask?.(task.taskId)}
                data-testid={`task-picker-item-${task.taskId}`}
              >
                <span className="task-picker__title-row">
                  <span className="task-picker__title">{task.title}</span>
                  {task.reviewStatus === 'reviewed' && (
                    <span className="status-chip status-chip--xs status-chip--completed">
                      Reviewed
                    </span>
                  )}
                </span>
                <span className="task-picker__meta">
                  {task.difficulty} &middot; {task.effectiveReward.toLocaleString()} &middot; {task.settlementStatus}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default TaskPicker;
