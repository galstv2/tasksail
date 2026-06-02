import type {
  PersistedContextPackCreation,
} from '../contextPackCreationTypes';
import {
  hydratePersistedContextPackCreation,
  isPersistedContextPackCreation,
} from '../contextPackCreationTypes';
import { createLogger } from '../log/logger';

export const CONTEXT_PACK_CREATION_DRAFT_KEY = 'context-pack-creation-draft.v1';

const MAX_DRAFT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const log = createLogger('src/renderer/hooks/useContextPackCreationDraftPersistence');

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPersistedContextPackCreationDraft(): PersistedContextPackCreation | null {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(CONTEXT_PACK_CREATION_DRAFT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedContextPackCreation(parsed)) {
      storage.removeItem(CONTEXT_PACK_CREATION_DRAFT_KEY);
      return null;
    }
    const savedAt = Date.parse(parsed.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_DRAFT_AGE_MS) {
      storage.removeItem(CONTEXT_PACK_CREATION_DRAFT_KEY);
      log.warn('context-pack.creation-draft.discarded');
      return null;
    }
    return hydratePersistedContextPackCreation(parsed);
  } catch {
    storage.removeItem(CONTEXT_PACK_CREATION_DRAFT_KEY);
    return null;
  }
}

export function savePersistedContextPackCreationDraft(
  envelope: PersistedContextPackCreation,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(CONTEXT_PACK_CREATION_DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage can be unavailable or full in packaged contexts.
  }
}

export function clearPersistedContextPackCreationDraft(): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(CONTEXT_PACK_CREATION_DRAFT_KEY);
  } catch {
    // localStorage can be unavailable in packaged contexts.
  }
}
