import type { TaskBoardContentColumn } from '../../../shared/desktopContract';
import MarkdownView from '../MarkdownView';
import ModalShell from '../ModalShell';

export type TaskDetailModalProps = {
  title: string | null;
  content: string;
  column: TaskBoardContentColumn;
  onClose: () => void;
  zIndex?: number;
  escPriority?: number;
};

const COLUMN_LABELS: Record<TaskBoardContentColumn, string> = {
  open: 'Open',
  pending: 'Pending',
  error: 'Failed',
  completed: 'Completed',
};

const COLUMN_ACCENT: Record<TaskBoardContentColumn, string> = {
  open: 'var(--ts-brand-gold)',
  pending: 'var(--ts-brand-cloudblue)',
  error: 'var(--ts-brand-burgundy)',
  completed: 'var(--ts-brand-green)',
};

function TaskDetailModal({
  title,
  content,
  column,
  onClose,
  zIndex,
  escPriority,
}: TaskDetailModalProps): JSX.Element {
  return (
    <ModalShell
      isOpen={true}
      onClose={onClose}
      title={title ?? 'Task'}
      headerLeft={<span className="task-detail-modal__column-dot" style={{ background: COLUMN_ACCENT[column], boxShadow: `0 0 6px color-mix(in srgb, ${COLUMN_ACCENT[column]} 40%, transparent)` }} />}
      maxWidth="660px"
      variant="terminal"
      accentColor={COLUMN_ACCENT[column]}
      className={`task-detail-modal--${column}`}
      zIndex={zIndex}
      escPriority={escPriority}
      footer={<>
        <span className="modal-shell__footer-esc">ESC to close</span>
        <span className="task-detail-modal__column-badge" data-column={column}>
          <span className="task-detail-modal__badge-dot" />
          {COLUMN_LABELS[column]}
        </span>
      </>}
      ariaLabel={title ?? 'Task detail'}
    >
      <MarkdownView content={content} />
    </ModalShell>
  );
}

export default TaskDetailModal;
