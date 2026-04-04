import { useCallback, useMemo, useRef, useEffect } from 'react';

import { isDraftDirty, type AgentInstructionsEditorProps } from '../hooks/useAgentInstructionsModal';
import ConfirmOverlay from './ConfirmOverlay';
import ModalShell from './ModalShell';

import '../styles/agentInstructions.css';

const IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const SAVE_HINT = IS_MAC ? '\u2318S' : 'Ctrl+S';

function AgentInstructionsEditor(props: AgentInstructionsEditorProps): JSX.Element | null {
  const {
    isOpen,
    file,
    saving,
    confirmCloseVisible,
    onEditorChange,
    onSave,
    onDiscard,
    onClose,
    onConfirmClose,
    onCancelClose,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      onEditorChange(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  }, [onEditorChange]);

  const dirty = file ? isDraftDirty(file) : false;
  const editorContent = file?.editorContent ?? '';
  const lineCount = useMemo(() => editorContent.split('\n').length, [editorContent]);

  if (!file) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      variant="terminal"
      title={<>
        {dirty && <span className="instructions-editor__dirty-dot">●</span>}
        {file.fileName}
      </>}
      subtitle={file.relativePath}
      maxWidth="740px"
      maxHeight="min(88vh, 840px)"
      zIndex={101}
      escPriority={1}
      footer={<>
        <span className="modal-shell__footer-esc">ESC to close</span>
        <div className="instructions-editor__actions">
          <button
            type="button"
            className="mcp-modal__btn"
            disabled={!dirty}
            onClick={onDiscard}
          >
            Discard
          </button>
          <button
            type="button"
            className="mcp-modal__btn mcp-modal__btn--primary"
            disabled={!dirty || saving}
            onClick={() => void onSave()}
          >
            {saving ? 'Saving\u2026' : <>Save <span className="instructions-editor__kbd">{SAVE_HINT}</span></>}
          </button>
        </div>
      </>}
      ariaLabel={`Editing ${file.fileName}`}
    >
      <textarea
        ref={textareaRef}
        className="instructions-editor__textarea"
        value={file.editorContent}
        onChange={(e) => onEditorChange(e.target.value)}
        onKeyDown={handleTextareaKeyDown}
        spellCheck={false}
        aria-label={file.relativePath}
      />
      <div className="instructions-editor__line-count">
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
      </div>

      <ConfirmOverlay
        visible={confirmCloseVisible}
        icon={
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ background: 'color-mix(in srgb, var(--ts-warning) 12%, transparent)', borderRadius: '50%', padding: 6 }}>
            <path d="M12 2L2 22h20L12 2z" stroke="var(--ts-warning)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
            <path d="M12 10v4" stroke="var(--ts-warning)" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="17.5" r="1" fill="var(--ts-warning)" />
          </svg>
        }
        title="Unsaved changes"
        body={`"${file.fileName}" has unsaved edits that will be lost.`}
        cancelLabel="Keep Editing"
        confirmLabel="Discard & Close"
        confirmVariant="danger"
        autoFocusCancel
        onCancel={onCancelClose}
        onConfirm={onConfirmClose}
      />
    </ModalShell>
  );
}

export default AgentInstructionsEditor;
