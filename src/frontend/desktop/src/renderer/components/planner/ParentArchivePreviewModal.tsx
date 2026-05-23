import type { PlannerReadParentArchiveMarkdownResponse } from '../../../shared/desktopContract';
import MarkdownView from '../MarkdownView';
import ModalShell, { ModalShellEscHint } from '../ModalShell';
import { formatParentArchiveTimestamp } from './parentArchiveTimestamp';

export type ParentArchivePreviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  error: string | null;
  archive: PlannerReadParentArchiveMarkdownResponse | null;
  onRetry: () => void;
};

export function ParentArchivePreviewModal({
  isOpen,
  onClose,
  loading,
  error,
  archive,
  onRetry,
}: ParentArchivePreviewModalProps): JSX.Element | null {
  const timestamp = archive?.archivedAt ? formatParentArchiveTimestamp(archive.archivedAt) : null;
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={archive?.title ?? 'Parent archive'}
      subtitle={timestamp ?? undefined}
      maxWidth="760px"
      maxHeight="82vh"
      variant="terminal"
      className="parent-archive-preview"
      zIndex={102}
      escPriority={20}
      footer={<ModalShellEscHint />}
      ariaLabel="Parent archive preview"
    >
      {archive?.archivePath ? (
        <div className="parent-archive-preview__path">{archive.archivePath}</div>
      ) : null}
      {loading ? (
        <div className="parent-archive-preview__state" role="status">Loading parent archive...</div>
      ) : error ? (
        <div className="parent-archive-preview__state" role="alert">
          <span>{error}</span>
          <button type="button" className="planner-modal__secondary-btn" onClick={onRetry}>Retry</button>
        </div>
      ) : archive ? (
        <MarkdownView content={archive.content} />
      ) : null}
    </ModalShell>
  );
}
