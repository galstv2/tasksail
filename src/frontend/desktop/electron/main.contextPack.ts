/**
 * Barrel re-export for context pack modules.
 * Tests and main.ts import from './main.contextPack' — this file
 * aggregates the catalog and action modules into a single seam.
 */

export {
  getDefaultContextPackSearchRoots,
  resolveContextPackSearchRoots,
  deriveContextPackRuntimeState,
  getContextPackCatalogRoots,
  listAvailableContextPacks,
} from './main.contextPackCatalog';

export {
  CONTEXT_PACK_TREE_STATIC_DENY_LIST,
  executeContextPackListRepoTreeAction,
} from './main.contextPackTree';

export {
  buildContextPackWorkspaceArgs,
  runContextPackWorkspaceScript,
  buildContextPackReseedArgs,
  runContextPackReseedCommand,
  runPythonScriptCommand,
  buildContextPackDiscoveryArgs,
  pickContextPackDirectoryAction,
  executeContextPackDiscoveryAction,
  buildContextPackBootstrapArgs,
  buildQmdSeedPlanArgs,
  buildContextPackSeedArgs,
  executeContextPackCreateAction,
  executeContextPackReseedAction,
  executeContextPackWorkspaceAction,
  pickMarkdownFileAction,
  executeSetRepoFocusAction,
  executeSetRepoCategoryAction,
} from './main.contextPackActions';
