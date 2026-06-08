import { useState } from 'react';

import type {
  OperatorStatus,
  PendingQueueItem,
  TaskRecoveryState,
} from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

type OperatorQueueSectionProps = {
  operatorStatus: OperatorStatus;
  pendingQueueItems: PendingQueueItem[];
  errorItemsCount?: number;
  recoveryState?: TaskRecoveryState | null;
  onDeletePendingItem: (queueName: string) => Promise<void>;
};

/**
 * Derive legacy statusTone from activeTasks array length.
 * activeTasks.length > 0 → RUNNING (warn); otherwise → OPEN (ok).
 */
function statusTone(status: OperatorStatus): 'ok' | 'warn' | 'idle' {
  return status.activeTasks.length > 0 ? 'warn' : 'ok';
}

/**
 * Derive legacy display label from OperatorStatus for backward-compatible UI.
 */
function statusLabel(status: OperatorStatus): string {
  if (status.activeTasks.length > 0) {
    return `RUNNING (${status.activeTasks.length} active)`;
  }
  return 'OPEN';
}

function renderItemLabel(item: PendingQueueItem): string {
  return item.title || item.taskId || item.queueName;
}

function OperatorQueueSection({
  operatorStatus,
  pendingQueueItems,
  errorItemsCount,
  recoveryState,
  onDeletePendingItem,
}: OperatorQueueSectionProps): JSX.Element {
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const runAction = async (actionKey: string, action: () => Promise<void>): Promise<void> => {
    setBusyAction(actionKey);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="obs-section">
      <div className="operator-queue__header">
        <div>
          <h3 className="obs-section__title">Operator Queue Control</h3>
          <p className="obs-section__desc">
            Shows the operator-facing queue state and the recovery actions allowed from the desktop shell.
          </p>
        </div>
        <span
          className={classNames(
            'operator-queue__status',
            `operator-queue__status--${statusTone(operatorStatus)}`,
          )}
        >
          {statusLabel(operatorStatus)}
        </span>
      </div>

      {typeof errorItemsCount === 'number' && errorItemsCount > 0 && (
        <p className="obs-section__info">
          {errorItemsCount} error item(s) recorded in AgentWorkSpace/error-items/.
        </p>
      )}

      {recoveryState ? (
        <p className="obs-section__info">
          Recovery {recoveryState.status}: {recoveryState.summary}
        </p>
      ) : (
        <p className="obs-section__empty">No failed pipeline is currently holding the queue.</p>
      )}

      <div className="operator-queue__list">
        {pendingQueueItems.length === 0 ? (
          <p className="obs-section__empty">No pending queue items are available.</p>
        ) : (
          pendingQueueItems.map((item) => (
            <div key={item.queueName} className="operator-queue__item">
              <div className="operator-queue__item-copy">
                <strong>{renderItemLabel(item)}</strong>
                <span>{item.queueName}</span>
              </div>
              <div className="operator-queue__item-actions">
                <span className={`operator-queue__pill operator-queue__pill--${item.state}`}>
                  {item.state.toUpperCase()}
                </span>
                {item.canDelete && (
                  <button
                    type="button"
                    className="obs-action-btn obs-action-btn--ghost"
                    disabled={busyAction !== null}
                    onClick={() => {
                      if (!window.confirm(`Delete pending queue item ${item.queueName}?`)) {
                        return;
                      }
                      void runAction(`delete:${item.queueName}`, () => onDeletePendingItem(item.queueName));
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default OperatorQueueSection;
