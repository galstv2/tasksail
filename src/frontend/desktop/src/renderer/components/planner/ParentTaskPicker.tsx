import { useMemo, useRef, useState } from 'react';

import type { ArchivedTaskChildParentBlockedTip, ArchivedTaskEntry } from '../../../shared/desktopContract';
import { PlannerDropdownListbox, type PlannerDropdownListboxItem } from './PlannerDropdownListbox';
import { PlannerPickerRow } from './PlannerPickerRow';
import { formatParentArchiveTimestamp } from './parentArchiveTimestamp';

export type ParentTaskPickerProps = {
  selectedTask: ArchivedTaskEntry | null | undefined;
  tasks: readonly ArchivedTaskEntry[];
  totalCount: number;
  blockedTips?: readonly ArchivedTaskChildParentBlockedTip[];
  loadingArchivedTasks?: boolean;
  loadingChildTaskParent?: boolean;
  onSelectTask: (task: ArchivedTaskEntry) => void;
};

function timestampMs(task: ArchivedTaskEntry): number | null {
  if (!task.archivedAt) return null;
  const ms = new Date(task.archivedAt).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function taskRightLabel(task: ArchivedTaskEntry): string {
  const formatted = task.archivedAt ? formatParentArchiveTimestamp(task.archivedAt) : null;
  return formatted ?? task.year ?? 'Archived';
}

function sortTasks(tasks: readonly ArchivedTaskEntry[]): ArchivedTaskEntry[] {
  return tasks
    .map((task, index) => ({ task, index, ms: timestampMs(task) }))
    .sort((left, right) => {
      if (left.ms !== null && right.ms !== null && left.ms !== right.ms) return right.ms - left.ms;
      if (left.ms !== null && right.ms === null) return -1;
      if (left.ms === null && right.ms !== null) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.task);
}

function triggerLabel(args: {
  selectedTask?: ArchivedTaskEntry | null;
  loadingArchivedTasks?: boolean;
  loadingChildTaskParent?: boolean;
  tasks: readonly ArchivedTaskEntry[];
  blockedTips: readonly ArchivedTaskChildParentBlockedTip[];
  totalCount: number;
}): string {
  if (args.loadingChildTaskParent) return 'Loading parent task...';
  if (args.loadingArchivedTasks) return 'Loading archived tasks...';
  if (args.selectedTask) return args.selectedTask.title;
  if (args.tasks.length > 0) return 'Select a completed parent task...';
  if (args.blockedTips.length > 0) return 'Child task already reserved';
  if (args.totalCount > 0) {
    return `${args.totalCount} archived task${args.totalCount === 1 ? '' : 's'} found, but none have a saved planner focus`;
  }
  return 'No completed tasks found in archive';
}

function blockedTipMeta(tip: ArchivedTaskChildParentBlockedTip): string {
  switch (tip.boardState) {
    case 'open': return 'Reserved · Open';
    case 'pending': return 'Reserved · Pending';
    case 'active': return 'Reserved · Active';
    case 'failed': return 'Reserved · Needs attention';
    case null: return 'Reserved · Status unavailable';
  }
}

function blockedTipId(tip: ArchivedTaskChildParentBlockedTip): string {
  return `blocked:${tip.rootTaskId}:${tip.currentTipTaskId}`;
}

export function ParentTaskPicker({
  selectedTask,
  tasks,
  totalCount,
  blockedTips = [],
  loadingArchivedTasks,
  loadingChildTaskParent,
  onSelectTask,
}: ParentTaskPickerProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);
  const byId = useMemo(() => new Map(sortedTasks.map((task) => [task.taskId, task])), [sortedTasks]);
  const blockedTipById = useMemo(
    () => new Map(blockedTips.map((tip) => [blockedTipId(tip), tip])),
    [blockedTips],
  );
  const items = useMemo<PlannerDropdownListboxItem[]>(
    () => [
      ...sortedTasks.map((task) => ({
        id: task.taskId,
        ariaLabel: `${task.title}, ${taskRightLabel(task)}`,
      })),
      ...blockedTips.map((tip) => ({
        id: blockedTipId(tip),
        ariaLabel: `${tip.title ?? tip.currentTipTaskId}, ${blockedTipMeta(tip)}. ${tip.message}`,
        disabled: true,
      })),
    ],
    [blockedTips, sortedTasks],
  );
  const disabled = Boolean(loadingArchivedTasks || loadingChildTaskParent || (sortedTasks.length === 0 && blockedTips.length === 0));

  return (
    <div className="parent-task-picker" aria-label="Parent task selection">
      <span className="parent-task-picker__label">Parent task:</span>
      <button
        ref={triggerRef}
        type="button"
        className="parent-task-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="parent-task-picker-listbox"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="parent-task-picker__trigger-title">
          {triggerLabel({ selectedTask, loadingArchivedTasks, loadingChildTaskParent, tasks, blockedTips, totalCount })}
        </span>
        {selectedTask ? (
          <span className="parent-task-picker__trigger-time">{taskRightLabel(selectedTask)}</span>
        ) : null}
      </button>
      <PlannerDropdownListbox
        open={open}
        triggerRef={triggerRef}
        items={items}
        listboxId="parent-task-picker-listbox"
        className={[
          'parent-task-picker__popover',
          open ? 'parent-task-picker__popover--open' : 'parent-task-picker__popover--closed',
        ].join(' ')}
        getOptionId={(item) => `parent-task-picker-option-${item.id}`}
        onClose={() => setOpen(false)}
        onSelect={(id) => {
          const task = byId.get(id);
          if (task) onSelectTask(task);
        }}
        renderItem={(item, state) => {
          const task = byId.get(item.id);
          if (!task) {
            const blockedTip = blockedTipById.get(item.id);
            if (!blockedTip) return null;
            return (
              <PlannerPickerRow
                optionId={state.optionId}
                title={blockedTip.title ?? blockedTip.currentTipTaskId}
                meta={blockedTipMeta(blockedTip)}
                chip="Reserved"
                tooltip={blockedTip.message}
                ariaLabel={item.ariaLabel}
                disabled
                isActive={state.isActive}
                isFirst={state.isFirst}
                onSelect={state.onSelect}
                onHover={state.onHover}
              />
            );
          }
          return (
            <PlannerPickerRow
              optionId={state.optionId}
              title={task.title}
              meta={<span className="planner-picker-row__time">{taskRightLabel(task)}</span>}
              isActive={state.isActive}
              isFirst={state.isFirst}
              onSelect={state.onSelect}
              onHover={state.onHover}
            />
          );
        }}
      />
    </div>
  );
}

export default ParentTaskPicker;
