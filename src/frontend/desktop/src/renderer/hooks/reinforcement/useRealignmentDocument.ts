import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ReinforcementGlobalDocData } from '../../../shared/desktopContract';
import { ERROR_CODE_VERSION_CONFLICT } from '../../../shared/desktopContract';
import type { DesktopShellClient } from '../../services/desktopShellClient';
import { desktopShellClient } from '../../services/desktopShellClient';
import { splitLines } from '../../utils/splitLines';

export type DocumentDraft = {
  standingExpectations: string;
  behavioralGuidance: string;
  lessonsLearned: string;
  fairnessFraming: string;
};

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; message: string }
  | { status: 'error'; message: string }
  | { status: 'conflict'; message: string };

export type UseRealignmentDocumentResult = {
  draft: DocumentDraft;
  version: number;
  updatedAt: string;
  loading: boolean;
  loadError: string | null;
  saveState: SaveState;
  dirty: boolean;
  onFieldChange: (field: keyof DocumentDraft, value: string) => void;
  onSave: (contextPackDir: string) => Promise<void>;
  onDiscard: () => void;
  reload: () => Promise<void>;
};

const EMPTY_DRAFT: DocumentDraft = {
  standingExpectations: '',
  behavioralGuidance: '',
  lessonsLearned: '',
  fairnessFraming: '',
};

function docToDraft(doc: ReinforcementGlobalDocData): DocumentDraft {
  return {
    standingExpectations: (doc.standingExpectations ?? []).join('\n'),
    behavioralGuidance: (doc.behavioralGuidance ?? []).join('\n'),
    lessonsLearned: (doc.lessonsLearned ?? []).join('\n'),
    fairnessFraming: (doc.fairnessFraming ?? []).join('\n'),
  };
}

export function useRealignmentDocument(
  activeContextPackDir: string | null,
  client: DesktopShellClient = desktopShellClient,
): UseRealignmentDocumentResult {
  const [draft, setDraft] = useState<DocumentDraft>(EMPTY_DRAFT);
  const [baseline, setBaseline] = useState<DocumentDraft>(EMPTY_DRAFT);
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const requestGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (!activeContextPackDir) {
      setDraft(EMPTY_DRAFT);
      setBaseline(EMPTY_DRAFT);
      setVersion(0);
      setUpdatedAt('');
      return;
    }
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await client.readRealignmentDoc();
      if (generation !== requestGenerationRef.current) return;
      if (result.ok && result.response.action === 'reinforcement.readRealignmentDoc') {
        const d = docToDraft(result.response.document);
        setDraft(d);
        setBaseline(d);
        setVersion(result.response.document.version);
        setUpdatedAt(result.response.document.updatedAt);
      } else if (!result.ok) {
        setLoadError(result.error);
      }
    } catch (err: unknown) {
      if (generation !== requestGenerationRef.current) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load document.');
    } finally {
      if (generation === requestGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [activeContextPackDir, client]);

  // Reset and reload on pack change
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setBaseline(EMPTY_DRAFT);
    setVersion(0);
    setUpdatedAt('');
    setLoadError(null);
    setSaveState({ status: 'idle' });
    requestGenerationRef.current += 1;
    load().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContextPackDir]);

  const onFieldChange = useCallback((field: keyof DocumentDraft, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setSaveState({ status: 'idle' });
  }, []);

  const dirty = useMemo(
    () =>
      draft.standingExpectations !== baseline.standingExpectations ||
      draft.behavioralGuidance !== baseline.behavioralGuidance ||
      draft.lessonsLearned !== baseline.lessonsLearned ||
      draft.fairnessFraming !== baseline.fairnessFraming,
    [draft, baseline],
  );

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const versionRef = useRef(version);
  versionRef.current = version;

  const onSave = useCallback(
    async (contextPackDir: string) => {
      const d = draftRef.current;
      setSaveState({ status: 'saving' });
      try {
        const result = await client.updateRealignmentDoc({
          contextPackDir,
          updates: {
            expected_version: versionRef.current,
            standingExpectations: splitLines(d.standingExpectations),
            behavioralGuidance: splitLines(d.behavioralGuidance),
            lessonsLearned: splitLines(d.lessonsLearned),
            fairnessFraming: splitLines(d.fairnessFraming),
          },
        });
        if (result.ok && result.response.action === 'reinforcement.updateRealignmentDoc') {
          setSaveState({ status: 'saved', message: result.response.message });
          // Backend version and updatedAt become authoritative after save
          await load();
        } else if (!result.ok && result.errorCode === ERROR_CODE_VERSION_CONFLICT) {
          setSaveState({
            status: 'conflict',
            message: 'The document was modified externally. Reload to see the latest version before saving.',
          });
        } else {
          setSaveState({
            status: 'error',
            message: result.ok ? 'Unexpected response.' : result.error,
          });
        }
      } catch (err: unknown) {
        setSaveState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Save failed.',
        });
      }
    },
    [client, load],
  );

  const onDiscard = useCallback(() => {
    setDraft(baseline);
    setSaveState({ status: 'idle' });
  }, [baseline]);

  return {
    draft,
    version,
    updatedAt,
    loading,
    loadError,
    saveState,
    dirty,
    onFieldChange,
    onSave,
    onDiscard,
    reload: load,
  };
}
