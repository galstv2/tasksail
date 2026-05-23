import { useMemo, type RefObject } from 'react';

import type { PlannerListConversationHistorySummary } from '../../../shared/desktopContractPlanner';
import { PlannerDropdownListbox, type PlannerDropdownListboxItem } from './PlannerDropdownListbox';
import { RecentsRow } from './RecentsRow';

export type RecentsErrorState = 'refresh-failed' | null;

export interface RecentsPopoverProps {
  open: boolean;
  records: PlannerListConversationHistorySummary[];
  triggerRef: RefObject<HTMLButtonElement>;
  onSelect: (recordId: string) => void;
  onClose: () => void;
  errorState?: RecentsErrorState;
  onRetry?: () => void;
}

export function RecentsPopover(props: RecentsPopoverProps) {
  const { open, records, triggerRef, onSelect, onClose, errorState, onRetry } = props;
  const items = useMemo<PlannerDropdownListboxItem[]>(
    () => records.map((record) => ({ id: record.id, ariaLabel: record.title })),
    [records],
  );
  const byId = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const topAccessory = errorState === 'refresh-failed' ? (
    <div className="recents-popover__error-bar" role="status">
      <span className="recents-popover__error-text">Couldn&rsquo;t refresh recent conversations.</span>
      {onRetry && (
        <button type="button" className="recents-popover__error-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  ) : undefined;

  return (
    <PlannerDropdownListbox
      open={open}
      triggerRef={triggerRef}
      items={items}
      listboxId="recents-listbox"
      className={[
        'recents-popover',
        open ? 'recents-popover--open' : 'recents-popover--closed',
      ].join(' ')}
      testId="recents-popover"
      getOptionId={(item) => `recents-row-${item.id}`}
      onSelect={onSelect}
      onClose={onClose}
      topAccessory={topAccessory}
      renderItem={(item, state) => {
        const record = byId.get(item.id);
        if (!record) return null;
        return (
          <RecentsRow
            record={record}
            isActive={state.isActive}
            isFirst={state.isFirst}
            onSelect={state.onSelect}
            onHover={state.onHover}
          />
        );
      }}
    />
  );
}

export default RecentsPopover;
