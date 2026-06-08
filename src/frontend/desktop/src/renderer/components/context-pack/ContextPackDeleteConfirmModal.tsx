import type { ContextPackCatalogEntry } from '../../../shared/desktopContract';
import { basename } from '../deep-focus/SidebarDeepFocusUtils';
import ModalShell, { ModalShellEscHint } from '../shared/ModalShell';

type ContextPackDeleteConfirmModalProps = {
  isOpen: boolean;
  selectedPack: ContextPackCatalogEntry | undefined;
  repoRoot?: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

function mirrorPath(repoRoot: string | undefined, contextPackDir: string): string {
  const root = repoRoot || '';
  const name = basename(contextPackDir);
  return `${root}/AgentWorkSpace/qmd/context-packs/${name}`;
}

export default function ContextPackDeleteConfirmModal({
  isOpen,
  selectedPack,
  repoRoot,
  pending,
  onClose,
  onConfirm,
}: ContextPackDeleteConfirmModalProps): JSX.Element {
  const contextPackDir = selectedPack?.contextPackDir ?? '';
  const packName = selectedPack?.displayName ?? 'the selected context pack';
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Delete context pack"
      subtitle={selectedPack?.displayName}
      ariaLabel="Delete context pack"
      maxWidth="420px"
      maxHeight="auto"
      footer={(
        <>
          <ModalShellEscHint />
          <button type="button" className="action-button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="action-button action-button--danger"
            onClick={() => void onConfirm()}
            disabled={pending || !selectedPack}
          >
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </>
      )}
    >
      <div className="context-pack-delete-modal">
        <p className="context-pack-delete-modal__warning">
          Are you sure? This is a destructive action.
        </p>
        <p className="context-pack-delete-modal__body">
          {`This removes ${packName} from:`}
        </p>
        <dl className="context-pack-delete-modal__paths">
          <div className="context-pack-delete-modal__path-row">
            <dt>Canonical</dt>
            <dd><code>{contextPackDir}</code></dd>
          </div>
          <div className="context-pack-delete-modal__path-row">
            <dt>Agent mirror</dt>
            <dd><code>{mirrorPath(repoRoot, contextPackDir)}</code></dd>
          </div>
        </dl>
      </div>
    </ModalShell>
  );
}
