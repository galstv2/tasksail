import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { PlannerPickerRow } from './PlannerPickerRow';
import { formatPlannerDropdownTimestamp } from './parentArchiveTimestamp';

export interface RecentsRowProps {
  record: PlannerListConversationHistorySummary;
  isActive: boolean;
  isFirst: boolean;
  onSelect: () => void;
  onHover: () => void;
}

function buildTooltip(record: PlannerListConversationHistorySummary): string {
  const parts: string[] = [`${record.messageCount} message${record.messageCount === 1 ? '' : 's'}`];
  if (record.primaryFocusRelativePath) parts.push(record.primaryFocusRelativePath);
  return parts.join(' · ');
}

export function RecentsRow(props: RecentsRowProps) {
  const { record, isActive, isFirst, onSelect, onHover } = props;

  const meta = (
    <span className="planner-picker-row__time">
      {formatPlannerDropdownTimestamp(record.createdAt) ?? record.createdAt}
    </span>
  );

  return (
    <PlannerPickerRow
      optionId={`recents-row-${record.id}`}
      testId={`recents-row-${record.id}`}
      title={record.title}
      meta={meta}
      chip={record.taskKind === 'child-task' ? 'child-task' : undefined}
      tooltip={buildTooltip(record)}
      isActive={isActive}
      isFirst={isFirst}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}

export default RecentsRow;
