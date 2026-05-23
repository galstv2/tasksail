import type { ReactNode } from 'react';

export interface PlannerPickerRowProps {
  optionId: string;
  testId?: string;
  title: string;
  meta?: ReactNode;
  chip?: string;
  tooltip?: string;
  ariaLabel?: string;
  disabled?: boolean;
  isActive: boolean;
  isFirst: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function PlannerPickerRow(props: PlannerPickerRowProps): JSX.Element {
  const { optionId, testId, title, meta, chip, tooltip, ariaLabel, disabled, isActive, isFirst, onSelect, onHover } = props;

  const className = [
    'planner-picker-row',
    isFirst ? 'planner-picker-row--first' : null,
    isActive ? 'planner-picker-row--active' : null,
    disabled ? 'planner-picker-row--disabled' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      role="option"
      id={optionId}
      aria-label={ariaLabel}
      aria-selected={isActive}
      aria-disabled={disabled || undefined}
      className={className}
      onClick={disabled ? undefined : onSelect}
      onMouseEnter={disabled ? undefined : onHover}
      {...(tooltip ? { title: tooltip } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {chip ? <span className="planner-picker-row__chip">{chip}</span> : null}
      <span className="planner-picker-row__title">{title}</span>
      {meta ? <span className="planner-picker-row__meta">{meta}</span> : null}
    </div>
  );
}

export default PlannerPickerRow;
