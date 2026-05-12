/**
 * Compatibility barrel - re-exports all context-pack action handlers from the
 * contextPackActions/* sub-modules.  All callers import from this file; the
 * implementation lives in the sibling sub-modules.
 *
 * Ref: context-pack-creation-hardening Phase 6 Gate G2.
 */

export {
  runContextPackWorkspaceScript,
  buildContextPackWorkspaceArgs,
  executeContextPackWorkspaceAction,
  type ContextPackWorkspaceScriptRunner,
} from './contextPackActions/workspace';

export {
  buildContextPackReseedArgs,
  runContextPackReseedCommand,
  executeContextPackReseedAction,
  type ContextPackReseedRunner,
} from './contextPackActions/reseed';

export {
  runPythonScriptCommand,
  type PythonScriptRunner,
} from './contextPackActions/shared';

export {
  buildContextPackDiscoveryArgs,
  pickContextPackDirectoryAction,
  executeContextPackDiscoveryAction,
} from './contextPackActions/discovery';

export {
  buildContextPackBootstrapArgs,
  buildQmdSeedPlanArgs,
  buildContextPackSeedArgs,
  buildWriteStubScopeTreeArgs,
  executeContextPackCreateAction,
} from './contextPackActions/create';

export { pickMarkdownFileAction } from './contextPackActions/pickMarkdownFile';

export {
  executeSetRepoFocusAction,
  executeSetRepoCategoryAction,
} from './contextPackActions/repositoryPreferences';

export {
  saveDeepFocusSelections,
  loadDeepFocusSelections,
  clearDeepFocusSelections,
} from './contextPackActions/deepFocusSelections';
