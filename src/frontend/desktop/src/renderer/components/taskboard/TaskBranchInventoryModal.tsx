import type { ArchivedTaskEntry } from '../../../shared/desktopContract';
import ModalShell, { ModalShellEscHint } from '../ModalShell';

type ArchivedBranchHandoff = NonNullable<ArchivedTaskEntry['branchHandoffs']>[number];

export type TaskBranchInventoryModalProps = {
  taskLabel: string;
  branchHandoffs: ArchivedBranchHandoff[];
  onClose: () => void;
  zIndex?: number;
  escPriority?: number;
};

type RegularTaskBranchInventoryRow = {
  repoRoot: string;
  repoLabel: string;
  sourceBranch: string;
  targetBranch: string | null;
  baseCommitSha: string;
  headCommitSha: string;
  commitsAhead: number;
  status: string;
  autoMerge: {
    enabled: boolean;
    status: string;
    targetBranch: string | null;
    detail: string;
  } | null;
};

function toRow(handoff: ArchivedBranchHandoff): RegularTaskBranchInventoryRow {
  return {
    repoRoot: handoff.repoRoot,
    repoLabel: handoff.repoLabel,
    sourceBranch: handoff.branch,
    targetBranch: handoff.autoMerge?.targetBranch ?? null,
    baseCommitSha: handoff.baseCommitSha,
    headCommitSha: handoff.headCommitSha,
    commitsAhead: handoff.commitsAhead,
    status: handoff.status,
    autoMerge: handoff.autoMerge ?? null,
  };
}

// Deterministic ordering so multi-repo tasks render predictably across runs.
function sortRows(rows: RegularTaskBranchInventoryRow[]): RegularTaskBranchInventoryRow[] {
  return [...rows].sort((left, right) => {
    const byLabel = left.repoLabel.localeCompare(right.repoLabel, undefined, { sensitivity: 'base' });
    if (byLabel !== 0) return byLabel;
    const byRoot = left.repoRoot.localeCompare(right.repoRoot, undefined, { sensitivity: 'base' });
    if (byRoot !== 0) return byRoot;
    return left.sourceBranch.localeCompare(right.sourceBranch, undefined, { sensitivity: 'base' });
  });
}

// Translate archived auto-merge state into operator-facing review language.
function reviewStatusLabel(autoMerge: RegularTaskBranchInventoryRow['autoMerge']): string {
  if (autoMerge?.status === 'applied') return 'Staged into target';
  if (autoMerge?.enabled) return 'Auto-merge skipped';
  return 'Manual review';
}

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function TaskBranchInventoryModal({
  taskLabel,
  branchHandoffs,
  onClose,
  zIndex,
  escPriority,
}: TaskBranchInventoryModalProps): JSX.Element {
  const rows = sortRows(branchHandoffs.map(toRow));
  return (
    <ModalShell
      isOpen={true}
      onClose={onClose}
      title="Task Branches"
      maxWidth="720px"
      variant="terminal"
      accentColor="var(--ts-brand-green)"
      className="task-branch-inventory-modal"
      zIndex={zIndex}
      escPriority={escPriority}
      ariaLabel={`Task branches for ${taskLabel}`}
      footer={<ModalShellEscHint />}
    >
      <div className="task-branch-inventory">
        <p className="task-branch-inventory__subtitle">
          Archived branch handoff for this completed task.
        </p>
        {rows.length === 0 ? (
          <p className="task-branch-inventory__empty">
            No source branches are recorded for this task.
          </p>
        ) : (
          <table className="task-branch-inventory__table">
            <thead>
              <tr>
                <th scope="col">Repo</th>
                <th scope="col">Source Branch</th>
                <th scope="col">Target</th>
                <th scope="col">Head</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.repoRoot}|${row.sourceBranch}`}>
                  <td>
                    <span className="task-branch-inventory__repo-label">
                      {row.repoLabel || row.repoRoot}
                    </span>
                    <span className="task-branch-inventory__repo-root">{row.repoRoot}</span>
                  </td>
                  <td className="task-branch-inventory__mono">{row.sourceBranch}</td>
                  <td className="task-branch-inventory__mono">
                    {row.targetBranch ?? (
                      <span className="task-branch-inventory__not-captured">Not captured</span>
                    )}
                  </td>
                  <td>
                    <span className="task-branch-inventory__sha" title={row.headCommitSha}>
                      {shortSha(row.headCommitSha)}
                    </span>
                    <span className="task-branch-inventory__ahead">+{row.commitsAhead} ahead</span>
                  </td>
                  <td>
                    <span className="task-branch-inventory__status">{reviewStatusLabel(row.autoMerge)}</span>
                    {row.autoMerge?.detail && (
                      <span className="task-branch-inventory__detail">{row.autoMerge.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ModalShell>
  );
}

export default TaskBranchInventoryModal;
