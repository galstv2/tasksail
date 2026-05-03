import type {
  ContextPackDeepFocusState,
  ContextPackDeepFocusTarget,
  ContextPackFocusTargetKind,
  ContextPackPrimaryFocusTarget,
  ContextPackRepoTreeEntry,
} from '../../shared/desktopContract';
import type { EditScopeCursor, SlotField } from './SidebarDeepFocusUtils';

export type DeepFocusCommit = {
  deepFocusEnabled: boolean;
  deepFocusPrimaryRepoId: string | null;
  deepFocusPrimaryFocusId: string | null;
  selectedFocusPath: string | null;
  selectedFocusTargetKind: ContextPackFocusTargetKind | null;
  selectedFocusTargets?: ContextPackPrimaryFocusTarget[];
  selectedTestTarget: ContextPackDeepFocusTarget | null | undefined;
  selectedSupportTargets: ContextPackDeepFocusTarget[];
};

export type DeepFocusMode = 'distributed' | 'monolith';

export type DeepFocusDraft = {
  selectedWorkingFocusIds: string[];
  state: ContextPackDeepFocusState;
  scopeCursor: EditScopeCursor;
};

export type TopLevelTarget = {
  id: string;
  label: string;
  rootPath: string;
  repoLocalPath: string;
  ancillaryAllowed: boolean;
  systemLayer: string | null;
};

export type TreeDirectoryListing = {
  topLevelId: string;
  topLevelLabel: string;
  topLevelPath: string;
  repoLocalPath: string;
  currentPath: string;
  entries: ContextPackRepoTreeEntry[];
  truncated: boolean;
};

export const PRIMARY_REMOVE_FADE_MS = 160;
export const PRIMARY_REMOVE_LAYOUT_HOLD_MS = 80;
export const PRIMARY_REMOVE_COMMIT_MS = PRIMARY_REMOVE_FADE_MS + PRIMARY_REMOVE_LAYOUT_HOLD_MS;

export type UndoEntry =
  | {
    kind: 'primary';
    target: ContextPackPrimaryFocusTarget;
    index: number;
    cursor: EditScopeCursor;
    label: string;
  }
  | {
    kind: 'slot';
    cursor: EditScopeCursor;
    field: SlotField;
    supportIndex?: number;
    target: ContextPackDeepFocusTarget;
    label: string;
  };
