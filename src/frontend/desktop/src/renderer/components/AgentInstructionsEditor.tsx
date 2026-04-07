import { useCallback, useMemo, useRef, useEffect, useState } from 'react';

import { isDraftDirty, type AgentInstructionsEditorProps } from '../hooks/useAgentInstructionsModal';
import { classNames } from '../utils/classNames';
import ConfirmOverlay from './ConfirmOverlay';
import MarkdownView from './MarkdownView';
import ModalShell from './ModalShell';

import '../styles/agentInstructions.css';

const IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const SAVE_HINT = IS_MAC ? '\u2318S' : 'Ctrl+S';

function AgentInstructionsEditor(props: AgentInstructionsEditorProps): JSX.Element | null {
  const {
    isOpen,
    file,
    activeDirectory,
    saving,
    confirmCloseVisible,
    confirmSaveVisible,
    onEditorChange,
    onRequestSave,
    onConfirmSave,
    onCancelSave,
    onDiscard,
    onClose,
    onConfirmClose,
    onCancelClose,
  } = props;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  useEffect(() => {
    if (isOpen) setMode('view');
  }, [isOpen, file?.relativePath]);

  useEffect(() => {
    if (isOpen && mode === 'edit' && textareaRef.current) {
      const timer = setTimeout(() => textareaRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen, mode]);

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
  const isTemplate = activeDirectory === 'templates';
  const editorContent = file?.editorContent ?? '';
  const lineCount = useMemo(() => editorContent.split('\n').length, [editorContent]);

  if (!file) return null;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      variant="terminal"
      className="instructions-editor-shell"
      title={<>
        {dirty && <span className="instructions-editor__dirty-dot">●</span>}
        {file.fileName}
      </>}
      subtitle={file.relativePath}
      maxWidth="820px"
      maxHeight="min(78vh, 640px)"
      zIndex={101}
      escPriority={1}
      footer={<>
        <span className="modal-shell__footer-esc">ESC to close</span>
        <div className="instructions-editor__actions">
          <div className="instructions-editor__mode-toggle" role="radiogroup" aria-label="View mode">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'view'}
              className={classNames('instructions-editor__mode-btn', mode === 'view' && 'instructions-editor__mode-btn--active')}
              onClick={() => setMode('view')}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              View
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'edit'}
              className={classNames('instructions-editor__mode-btn', mode === 'edit' && 'instructions-editor__mode-btn--active')}
              onClick={() => setMode('edit')}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              Edit
            </button>
          </div>
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
            onClick={onRequestSave}
          >
            {saving ? 'Saving\u2026' : <>Save <span className="instructions-editor__kbd">{SAVE_HINT}</span></>}
          </button>
        </div>
      </>}
      ariaLabel={mode === 'edit' ? `Editing ${file.fileName}` : `Viewing ${file.fileName}`}
    >
      {mode === 'view' ? (
        <div className="instructions-editor__view-pane">
          <MarkdownView content={editorContent} />
        </div>
      ) : (
        <>
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
        </>
      )}

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

      <ConfirmOverlay
        visible={confirmSaveVisible}
        icon={isTemplate
          ? <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ background: 'color-mix(in srgb, var(--ts-danger) 12%, transparent)', borderRadius: '50%', padding: 6 }}>
              <path d="M12 2L2 22h20L12 2z" stroke="var(--ts-danger)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
              <path d="M12 10v4" stroke="var(--ts-danger)" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="17.5" r="1" fill="var(--ts-danger)" />
            </svg>
          : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ background: 'color-mix(in srgb, var(--ts-warning) 12%, transparent)', borderRadius: '50%', padding: 6 }}>
              <path d="M12 2L2 22h20L12 2z" stroke="var(--ts-warning)" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
              <path d="M12 10v4" stroke="var(--ts-warning)" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="17.5" r="1" fill="var(--ts-warning)" />
            </svg>
        }
        title={isTemplate ? 'Save template file?' : 'Save instruction file?'}
        body={isTemplate
          ? <>
            This is a destructive action and can have adverse impact on this platform and cause things to break.
            Template <strong>{file.fileName}</strong> is a canonical reference used by agents during task execution.
          </>
          : <>
            This will overwrite <strong>{file.fileName}</strong> on disk.
            Changes to instruction files affect how agents behave in future runs.
          </>}
        cancelLabel="Cancel"
        confirmLabel={isTemplate ? 'Save Anyway' : 'Save'}
        confirmVariant={isTemplate ? 'danger' : 'primary'}
        autoFocusCancel
        onCancel={onCancelSave}
        onConfirm={() => void onConfirmSave()}
      />
    </ModalShell>
  );
}

export default AgentInstructionsEditor;
