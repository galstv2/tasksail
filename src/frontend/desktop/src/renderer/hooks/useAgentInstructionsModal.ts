import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  InstructionDirectory,
  InstructionFileEntry,
  AgentInstructionsListFilesResponse,
  AgentInstructionsReadFileResponse,
} from '../../shared/desktopContract';
import type { DesktopShellClient } from '../services/desktopShellClient';
import { desktopShellClient } from '../services/desktopShellClient';
import { useToastContext } from '../contexts/ToastContext';

export type InstructionsTab = InstructionDirectory;

export type FileState = {
  fileName: string;
  relativePath: string;
  savedContent: string;
  editorContent: string;
  loaded: boolean;
};

export const TAB_ORDER: InstructionsTab[] = ['profiles', 'instructions', 'prompts'];

const TAB_LABELS: Record<InstructionsTab, string> = {
  profiles: 'Profiles',
  instructions: 'Instructions',
  prompts: 'Prompts',
};

const DIRECTORY_LABELS: Record<InstructionsTab, string> = {
  profiles: '.github/agents/',
  instructions: '.github/copilot/instructions/',
  prompts: '.github/copilot/prompts/',
};

const EMPTY_FILES: Record<InstructionsTab, InstructionFileEntry[]> = {
  profiles: [],
  instructions: [],
  prompts: [],
};

export function isDraftDirty(draft: FileState | undefined): boolean {
  if (!draft) return false;
  return draft.editorContent !== draft.savedContent;
}

export { TAB_LABELS, DIRECTORY_LABELS };

// ── Browser props ───────────────────────────────────────��────────────

export type AgentInstructionsBrowserProps = {
  isOpen: boolean;
  isLoading: boolean;
  files: Record<InstructionsTab, InstructionFileEntry[]>;
  draftsByPath: Record<string, FileState>;
  error: string | null;
  /** Path currently loading content (for card pulse indicator) */
  loadingPath: string | null;
  onClose: () => void;
  onSelectFile: (relativePath: string) => void;
};

// ── Editor props ─────────────────────────────────────────────────────

export type AgentInstructionsEditorProps = {
  isOpen: boolean;
  file: FileState | null;
  saving: boolean;
  confirmCloseVisible: boolean;
  onEditorChange: (content: string) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onClose: () => void;
  onConfirmClose: () => void;
  onCancelClose: () => void;
};

// ── Combined result ──────────────────────────────────────────────────

export type UseAgentInstructionsModalResult = {
  browserProps: AgentInstructionsBrowserProps;
  editorProps: AgentInstructionsEditorProps;
  openAgentInstructionsModal: () => void;
};

export function useAgentInstructionsModal(
  client: DesktopShellClient = desktopShellClient,
): UseAgentInstructionsModalResult {
  const { addToast } = useToastContext();

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<Record<InstructionsTab, InstructionFileEntry[]>>(EMPTY_FILES);
  const [draftsByPath, setDraftsByPath] = useState<Record<string, FileState>>({});
  const [editingRelativePath, setEditingRelativePath] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCloseVisible, setConfirmCloseVisible] = useState(false);

  const loadingRef = useRef(false);
  const draftsByPathRef = useRef(draftsByPath);
  draftsByPathRef.current = draftsByPath;

  const editingDraft = editingRelativePath ? draftsByPath[editingRelativePath] ?? null : null;

  // ── Load file content (stable, reads ref) ──────────────────────────

  const loadFileContent = useCallback(
    async (relativePath: string): Promise<boolean> => {
      if (draftsByPathRef.current[relativePath]?.loaded) return true;

      setLoadingPath(relativePath);
      const result = await client.readInstructionFile(relativePath);
      setLoadingPath(null);

      if (!result.ok) {
        addToast({ severity: 'error', message: result.error ?? 'Failed to read file.', duration: 6000 });
        return false;
      }

      const response = result.response as AgentInstructionsReadFileResponse;
      setDraftsByPath((prev) => ({
        ...prev,
        [relativePath]: {
          fileName: response.fileName,
          relativePath: response.relativePath,
          savedContent: response.content,
          editorContent: response.content,
          loaded: true,
        },
      }));
      return true;
    },
    [client, addToast],
  );

  // ── Load all file lists on open ────────────────────────────────────

  const loadAllFiles = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        TAB_ORDER.map((dir) => client.listInstructionFiles(dir)),
      );

      const newFiles: Record<InstructionsTab, InstructionFileEntry[]> = {
        profiles: [],
        instructions: [],
        prompts: [],
      };

      for (let i = 0; i < TAB_ORDER.length; i++) {
        const tab = TAB_ORDER[i];
        const result = results[i];
        if (result.ok) {
          const response = result.response as AgentInstructionsListFilesResponse;
          newFiles[tab] = response.files;
        }
      }

      setFiles(newFiles);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to load instruction files: ${message}`);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [client]);

  // ── Open/close ─────────────────────────────────────────────────────

  const openAgentInstructionsModal = useCallback(() => {
    setIsOpen(true);
    setFiles(EMPTY_FILES);
    setDraftsByPath({});
    setEditingRelativePath(null);
    setLoadingPath(null);
    setError(null);
    setSaving(false);
    setConfirmCloseVisible(false);
  }, []);

  useEffect(() => {
    if (isOpen) void loadAllFiles();
  }, [isOpen, loadAllFiles]);

  // Browser close — discards all in-memory drafts
  const onBrowserClose = useCallback(() => {
    // Can't close browser while editor is open
    if (editingRelativePath) return;
    setIsOpen(false);
  }, [editingRelativePath]);

  // ── File selection → open editor ──────────────────────────────────

  const onSelectFile = useCallback(
    async (relativePath: string) => {
      const loaded = await loadFileContent(relativePath);
      if (loaded) {
        setEditingRelativePath(relativePath);
      }
    },
    [loadFileContent],
  );

  // ── Editor close with dirty protection ────────────────────────────

  const onEditorClose = useCallback(() => {
    if (!editingRelativePath) return;
    const draft = draftsByPathRef.current[editingRelativePath];
    if (draft && isDraftDirty(draft)) {
      setConfirmCloseVisible(true);
      return;
    }
    setEditingRelativePath(null);
  }, [editingRelativePath]);

  const revertDraft = useCallback((path: string) => {
    setDraftsByPath((prev) => {
      const existing = prev[path];
      if (!existing) return prev;
      return { ...prev, [path]: { ...existing, editorContent: existing.savedContent } };
    });
  }, []);

  const onConfirmClose = useCallback(() => {
    if (editingRelativePath) revertDraft(editingRelativePath);
    setConfirmCloseVisible(false);
    setEditingRelativePath(null);
  }, [editingRelativePath, revertDraft]);

  const onCancelClose = useCallback(() => {
    setConfirmCloseVisible(false);
  }, []);

  const onEditorChange = useCallback(
    (content: string) => {
      if (!editingRelativePath) return;
      setDraftsByPath((prev) => {
        const existing = prev[editingRelativePath];
        if (!existing || existing.editorContent === content) return prev;
        return { ...prev, [editingRelativePath]: { ...existing, editorContent: content } };
      });
    },
    [editingRelativePath],
  );

  // ── Save ──────────────────────────────────────────────────────────

  const onSave = useCallback(async () => {
    if (!editingRelativePath || !editingDraft || !isDraftDirty(editingDraft) || saving) return;

    setSaving(true);
    try {
      const result = await client.writeInstructionFile(
        editingRelativePath,
        editingDraft.editorContent,
      );
      if (!result.ok) {
        addToast({ severity: 'error', message: result.error ?? 'Save failed.', duration: 6000 });
        return;
      }
      setDraftsByPath((prev) => {
        const existing = prev[editingRelativePath];
        if (!existing) return prev;
        return {
          ...prev,
          [editingRelativePath]: {
            ...existing,
            savedContent: existing.editorContent,
          },
        };
      });
      addToast({ severity: 'success', message: `Saved ${editingDraft.fileName}.`, duration: 4000 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ severity: 'error', message: `Save failed: ${message}`, duration: 6000 });
    } finally {
      setSaving(false);
    }
  }, [editingRelativePath, editingDraft, saving, client, addToast]);

  // ── Discard ───────────────────────────────────────────────────────

  const onDiscard = useCallback(() => {
    if (!editingRelativePath) return;
    revertDraft(editingRelativePath);
  }, [editingRelativePath, revertDraft]);

  // ── Cmd/Ctrl+S saves the current dirty file ──────────────────────

  useEffect(() => {
    if (!editingRelativePath) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void onSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingRelativePath, onSave]);

  // ── Assemble props ────────────────────────────────────────────────

  const browserProps = useMemo<AgentInstructionsBrowserProps>(() => ({
    isOpen,
    isLoading,
    files,
    draftsByPath,
    error,
    loadingPath,
    onClose: onBrowserClose,
    onSelectFile,
  }), [isOpen, isLoading, files, draftsByPath, error, loadingPath, onBrowserClose, onSelectFile]);

  const editorIsOpen = editingRelativePath !== null && editingDraft?.loaded === true;

  const editorProps = useMemo<AgentInstructionsEditorProps>(() => ({
    isOpen: editorIsOpen,
    file: editingDraft,
    saving,
    confirmCloseVisible,
    onEditorChange,
    onSave,
    onDiscard,
    onClose: onEditorClose,
    onConfirmClose,
    onCancelClose,
  }), [editorIsOpen, editingDraft, saving, confirmCloseVisible, onEditorChange, onSave, onDiscard, onEditorClose, onConfirmClose, onCancelClose]);

  return { browserProps, editorProps, openAgentInstructionsModal };
}
