import type { TaskBoardContentColumn, TaskBoardMarkdownArtifact } from '../../../shared/desktopContract';
import MarkdownView from '../MarkdownView';
import ModalShell from '../ModalShell';
import TerminalSelectMenu, { type TerminalSelectMenuOption } from '../TerminalSelectMenu';

export type TaskDetailModalChildChainAction = {
  onViewChain: () => void;
  disabled?: boolean;
  loading?: boolean;
};

export type TaskDetailModalProps = {
  title: string | null;
  content: string;
  column: TaskBoardContentColumn;
  onClose: () => void;
  zIndex?: number;
  escPriority?: number;
  artifactExplorer?: {
    artifacts: TaskBoardMarkdownArtifact[];
    selectedRelativePath: string;
    onSelectArtifact: (relativePath: string) => void;
    disabled?: boolean;
  };
  childChainAction?: TaskDetailModalChildChainAction;
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

function artifactSortRank(relativePath: string): number {
  if (relativePath === 'archive.md') return 0;
  if (relativePath.startsWith('ImplementationSteps/')) return 1;
  if (relativePath.startsWith('handoffs/')) return 2;
  return 3;
}

function sortArtifactExplorerArtifacts(artifacts: TaskBoardMarkdownArtifact[]): TaskBoardMarkdownArtifact[] {
  return [...artifacts].sort((left, right) => {
    const rankDiff = artifactSortRank(left.relativePath) - artifactSortRank(right.relativePath);
    if (rankDiff !== 0) return rankDiff;
    return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' });
  });
}

function TaskDetailModal({
  title,
  content,
  column,
  onClose,
  zIndex,
  escPriority,
  artifactExplorer,
  childChainAction,
}: TaskDetailModalProps): JSX.Element {
  const showArtifactExplorer =
    column === 'completed' && !!artifactExplorer && artifactExplorer.artifacts.length > 1;
  const artifactOptions: TerminalSelectMenuOption[] = artifactExplorer
    ? sortArtifactExplorerArtifacts(artifactExplorer.artifacts).map((artifact) => ({
        value: artifact.relativePath,
        id: `task-detail-artifact-option-${artifact.relativePath.replace(/[^a-zA-Z0-9]+/g, '-')}`,
        primaryLabel: artifact.relativePath,
      }))
    : [];
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
        {column === 'completed' && childChainAction && (
          <button
            type="button"
            className="task-detail-modal__view-chain-btn"
            onClick={childChainAction.onViewChain}
            disabled={childChainAction.disabled || childChainAction.loading}
            aria-busy={childChainAction.loading || undefined}
            aria-label="View child chain repos and branches"
          >
            View Chain
          </button>
        )}
        <span className="task-detail-modal__column-badge" data-column={column}>
          <span className="task-detail-modal__badge-dot" />
          {COLUMN_LABELS[column]}
        </span>
      </>}
      ariaLabel={title ?? 'Task detail'}
    >
      {showArtifactExplorer && artifactExplorer && (
        <div className="task-detail-modal__artifact">
          <span className="task-detail-modal__artifact-label">Artifact Explorer</span>
          <TerminalSelectMenu
            className="terminal-select-menu--artifact"
            options={artifactOptions}
            selectedValue={artifactExplorer.selectedRelativePath}
            onSelect={artifactExplorer.onSelectArtifact}
            ariaLabel="Artifact Explorer"
            listboxId="task-detail-artifact-listbox"
            disabled={artifactExplorer.disabled}
          />
        </div>
      )}
      <MarkdownView content={content} />
    </ModalShell>
  );
}

export default TaskDetailModal;
