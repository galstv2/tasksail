import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { formatRecentsTimestamp } from '../SidebarDeepFocusUtils';

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

  const className = [
    'recents-row',
    isFirst ? 'recents-row--first' : null,
    isActive ? 'recents-row--active' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="option"
      id={`recents-row-${record.id}`}
      aria-selected={isActive}
      className={className}
      onClick={onSelect}
      onMouseEnter={onHover}
      title={buildTooltip(record)}
      data-testid={`recents-row-${record.id}`}
    >
      <div className="recents-row__primary">{record.title}</div>
      <div className="recents-row__secondary">
        {record.taskKind === 'child-task' && (
          <span className="recents-row__chip">child-task</span>
        )}
        <span className="recents-row__repo">{record.primaryRepoId}</span>
        <span className="recents-row__sep" aria-hidden="true">·</span>
        <span className="recents-row__time">{formatRecentsTimestamp(record.createdAt)}</span>
      </div>
      <span className="recents-row__chevron" aria-hidden="true">
        ›
      </span>
    </div>
  );
}

export default RecentsRow;
