/**
 * Compatibility barrel - re-exports all context-pack action handlers from the
 * contextPackActions/* sub-modules.  All callers import from this file; the
 * implementation lives in the sibling sub-modules.
 */

export {
  runContextPackWorkspaceScript,
  buildContextPackWorkspaceArgs,
  executeContextPackWorkspaceAction,
  type ContextPackWorkspaceScriptRunner,
} from './actions/workspace';

export {
  buildContextPackReseedArgs,
  runContextPackReseedCommand,
  executeContextPackReseedAction,
  type ContextPackReseedRunner,
} from './actions/reseed';

export {
  runPythonScriptCommand,
  type PythonScriptRunner,
} from './actions/shared';

export {
  buildContextPackDiscoveryArgs,
  pickContextPackDirectoryAction,
  executeContextPackDiscoveryAction,
} from './actions/discovery';

export {
  buildContextPackBootstrapArgs,
  buildQmdSeedPlanArgs,
  buildContextPackSeedArgs,
  buildWriteStubScopeTreeArgs,
  executeContextPackCreateAction,
} from './actions/create';

export { pickMarkdownFileAction } from './actions/pickMarkdownFile';

export {
  executeSetRepoFocusAction,
  executeSetRepoCategoryAction,
} from './actions/repositoryPreferences';

export {
  saveDeepFocusSelections,
  loadDeepFocusSelections,
  clearDeepFocusSelections,
} from './actions/deepFocusSelections';

export {
  listFocusFilters,
  createFocusFilter,
  deleteFocusFilter,
} from './actions/focusFilters';

export {
  loadContextPackSidebarState,
  saveContextPackSidebarState,
} from './actions/contextPackSidebarState';

export {
  executeContextPackDeleteAction,
} from './actions/delete';
