import type {
  TaskBoardChildChainBranchSourceKind,
  TaskBoardReadChildChainBranchInventoryResponse,
} from '../../../shared/desktopContract';
import ModalShell, { ModalShellEscHint } from '../ModalShell';

export type ChildChainBranchInventoryModalProps = {
  response: TaskBoardReadChildChainBranchInventoryResponse;
  onClose: () => void;
  zIndex?: number;
  escPriority?: number;
};

const SOURCE_KIND_LABELS: Record<TaskBoardChildChainBranchSourceKind, string> = {
  'parent-handoff': 'Parent handoff',
  'chain-history-handoff': 'Chain history',
  'introduced-by-child': 'Introduced by child',
  'legacy-root': 'Legacy root',
};

function ChildChainBranchInventoryModal({
  response,
  onClose,
  zIndex,
  escPriority,
}: ChildChainBranchInventoryModalProps): JSX.Element {
  const inventory = response.mode === 'loaded' ? response.inventory : undefined;
  return (
    <ModalShell
      isOpen={true}
      onClose={onClose}
      title="Child Chain Branches"
      maxWidth="720px"
      variant="terminal"
      accentColor="var(--ts-brand-green)"
      className="child-chain-inventory-modal"
      zIndex={zIndex}
      escPriority={escPriority}
      ariaLabel="Child chain branches"
      footer={<ModalShellEscHint />}
    >
      {inventory ? (
        <div className="child-chain-inventory">
          <dl className="child-chain-inventory__meta">
            <div>
              <dt>Root</dt>
              <dd>{inventory.rootTaskId}</dd>
            </div>
            <div>
              <dt>Current tip</dt>
              <dd>{inventory.currentTipTaskId}</dd>
            </div>
            <div>
              <dt>Tasks</dt>
              <dd>{inventory.taskCount}</dd>
            </div>
          </dl>
          {inventory.rows.length === 0 ? (
            <p className="child-chain-inventory__empty">
              No repos or branches are recorded for this chain.
            </p>
          ) : (
            <table className="child-chain-inventory__table">
              <thead>
                <tr>
                  <th scope="col">Repo</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Target</th>
                  <th scope="col">Introduced By</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {inventory.rows.map((row) => (
                  <tr key={`${row.repoRoot}|${row.chainSourceBranch}`}>
                    <td>
                      <span className="child-chain-inventory__repo-label">
                        {row.repoLabel || row.repoRoot}
                      </span>
                      <span className="child-chain-inventory__repo-root">{row.repoRoot}</span>
                    </td>
                    <td className="child-chain-inventory__mono">{row.chainSourceBranch}</td>
                    <td className="child-chain-inventory__mono">{row.targetBranch ?? '—'}</td>
                    <td>
                      {row.introducedAtTaskId}
                      <span className="child-chain-inventory__depth"> (depth {row.introducedAtDepth})</span>
                    </td>
                    <td>{SOURCE_KIND_LABELS[row.sourceKind] ?? row.sourceKind}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <p className="child-chain-inventory__message">{response.message}</p>
      )}
    </ModalShell>
  );
}

export default ChildChainBranchInventoryModal;
