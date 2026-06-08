import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot } from '../core/index.js';
import { getActiveProvider } from '../cli-provider/index.js';

export const GENERIC_REQUIRED_DIRS: string[] = [
  'AgentWorkSpace/dropbox',
  'AgentWorkSpace/pendingitems',
  'AgentWorkSpace/error-items',
  'AgentWorkSpace/tasks',
  'AgentWorkSpace/templates',
  'src/backend/scripts/python',
  'src/backend',
  'runtime/docker',
  'runtime/podman',
  'tests',
];

export function getRequiredDirs(repoRoot: string): string[] {
  return [
    ...getActiveProvider(repoRoot).requiredDirs(),
    ...GENERIC_REQUIRED_DIRS,
  ];
}

export const GENERIC_REQUIRED_FILES: string[] = [
  '.env.example',
  'Makefile',
];

export function getRequiredFiles(repoRoot: string): string[] {
  return [
    ...getActiveProvider(repoRoot).requiredFiles(),
    ...GENERIC_REQUIRED_FILES,
  ];
}

export interface StructureResult {
  valid: boolean;
  errors: string[];
}

type ThinWrapperForbiddenPattern = {
  pattern: RegExp;
  message: string;
};

const ELECTRON_MAIN_PATH = 'src/frontend/desktop/electron/main.ts';
const REPO_OBSERVABILITY_FACADE_PATH = 'src/frontend/desktop/electron/repoObservability.ts';
const REPO_OBSERVABILITY_INDEX_PATH = 'src/frontend/desktop/electron/repoObservability/index.ts';
const REPO_OBSERVABILITY_DIR_PATH = 'src/frontend/desktop/electron/repoObservability';

const ELECTRON_DIR_PATH = 'src/frontend/desktop/electron';

// The Electron main-process root is a deliberate, minimal set after the directory refactor:
// entrypoints (main/preload), shared cross-family utilities, the shared markdown parser, the
// build-pinned dev restart protocol, and the repoObservability facade. Every other production
// module must live in an ownership folder. Tests (*.test.ts) are allowed at the root. Add to this
// set ONLY when introducing a genuinely shared root file (a deliberate, reviewable act).
const ELECTRON_ROOT_ALLOWED_FILES = new Set<string>([
  'main.ts',
  'preload.ts',
  'repoObservability.ts',
  'paths.ts',
  'utils.ts',
  'main.textUtils.ts',
  'main.markdown.ts',
  'devRestartProtocol.ts',
]);

const RENDERER_DIR_PATH = 'src/frontend/desktop/src/renderer';

// Only frozen renderer-root files belong here: entrypoints, the cross-boundary
// activity stream module, and the test harness. Production modules should move
// into ownership folders unless a new root file is genuinely stable.
const RENDERER_ROOT_ALLOWED_FILES = new Set<string>([
  'main.tsx',
  'App.tsx',
  'App.test-setup.ts',
  'activityStream.ts',
]);

const PLATFORM_DIR_PATH = 'src/backend/platform';

// The platform TypeScript layer is organized as module folders (core/, queue/, agent-runner/,
// container/, validation/, ...). The only loose root files allowed are the Vitest tooling that
// configures the suite from the root; every other production module must live in a module folder.
// Test files (*.test.ts/.tsx) are admitted unconditionally by the skip in the boundary check. Add
// to this set ONLY for genuine root-level test tooling.
const PLATFORM_ROOT_ALLOWED_FILES = new Set<string>([
  'vitest.config.ts',
  'vitest.childProcessGuard.ts',
  'vitest.logIsolation.ts',
]);

const SCRIPTS_PYTHON_DIR_PATH = 'src/backend/scripts/python';

const SCRIPTS_PYTHON_ROOT_ALLOWED_FILES = new Set<string>([
  'activate-context-pack-helper.py',
  'approve-context-estate-manifest.py',
  'bootstrap-context-pack.py',
  'discover-context-estate.py',
  'dismiss-realignment-session.py',
  'file-task-archive.py',
  'plan-qmd-seeding.py',
  'realignment-ingest.py',
  'repo-context-app.py',
  'run-pack-preflight.py',
  'run-role-agent-helper.py',
  'run-targeted-tests.py',
  'start-realignment-session.py',
  'submit-reinforcement-feedback.py',
  'sync-context-pack-workspace.py',
  'update-global-realignment-doc.py',
  'update-pack-manifest.py',
  'upgrade-pack-on-activate.py',
  'upgrade-pack-schema.py',
  'validate-docs.py',
  'write-stub-scope-tree.py',
]);

const MCP_DIR_PATH = 'src/backend/mcp';

const MCP_ROOT_ALLOWED_FILES = new Set<string>([
  '__init__.py',
]);

const REPO_OBSERVABILITY_PUBLIC_EXPORTS = [
  'probePidLiveness',
  'inferGuardrailIdentity',
  'readQueueStatusSnapshot',
  'readObservabilitySnapshot',
] as const;

const ELECTRON_MAIN_FORBIDDEN_PATTERNS: ThinWrapperForbiddenPattern[] = [
  {
    pattern: /\bipcMain\.handle\s*\(/,
    message: 'main.ts must not register IPC handlers; use ipc/contract.ts',
  },
  {
    pattern: /\bnew\s+BrowserWindow\s*\(/,
    message: 'main.ts must not construct BrowserWindow; use app/windowManager.ts',
  },
  {
    pattern: /\bswitch\s*\(\s*request\.action\s*\)/,
    message: 'main.ts must not contain the desktop action switch; use ipc/desktopActionRouter.ts',
  },
  {
    pattern: /\b(?:type|interface)\s+DesktopActionHandlers\b/,
    message: 'main.ts must not define DesktopActionHandlers; use ipc/desktopActionHandlers.ts',
  },
  {
    pattern: /\bconst\s+defaultDesktopActionHandlers\b/,
    message: 'main.ts must not define default desktop action handlers; use ipc/desktopActionHandlers.ts',
  },
  {
    pattern: /\bstartRuntimeStreamWatcher\s*\(/,
    message: 'main.ts must not start the runtime stream watcher directly; use app/appController.ts',
  },
  {
    pattern: /\bstartTaskBoardWatcher\s*\(/,
    message: 'main.ts must not start the task board watcher directly; use app/appController.ts',
  },
  {
    pattern: /\bstartTaskRecoveryController\s*\(/,
    message: 'main.ts must not start task recovery directly; use app/appController.ts',
  },
  {
    pattern: /\bcleanupStalePipelineState\s*\(/,
    message: 'main.ts must not run startup recovery cleanup directly; use app/startupRecovery.ts',
  },
  {
    pattern: /\bschedulePipelineAutoStart\s*\(/,
    message: 'main.ts must not auto-start pipelines directly; use app/startupRecovery.ts',
  },
];

async function validateElectronMainThinWrapper(root: string): Promise<string[]> {
  const mainPath = path.join(root, ELECTRON_MAIN_PATH);
  let content: string;
  try {
    content = await fs.promises.readFile(mainPath, 'utf-8');
  } catch {
    return [];
  }

  const errors: string[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\/\/.*$/u, '');
    for (const rule of ELECTRON_MAIN_FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(line)) {
        errors.push(`${ELECTRON_MAIN_PATH}:${index + 1}: ${rule.message}`);
      }
    }
  }
  return errors;
}

function stripTypeScriptComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/u, ''))
    .join('\n');
}

function normalizeWhitespace(content: string): string {
  return content.replace(/\s+/gu, ' ').trim();
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function validateRepoObservabilityFacade(root: string): Promise<string[]> {
  const facadePath = path.join(root, REPO_OBSERVABILITY_FACADE_PATH);
  const indexPath = path.join(root, REPO_OBSERVABILITY_INDEX_PATH);
  const [facadeContent, indexContent] = await Promise.all([
    readOptionalFile(facadePath),
    readOptionalFile(indexPath),
  ]);
  const errors: string[] = [];
  const expectedFacade = normalizeWhitespace(
    `export {
        ${REPO_OBSERVABILITY_PUBLIC_EXPORTS.join(', ')},
      } from './repoObservability/index';`,
  );
  const expectedIndex = normalizeWhitespace(
    REPO_OBSERVABILITY_PUBLIC_EXPORTS
      .map((name) => `export { ${name} } from './${repoObservabilityExportModule(name)}';`)
      .join('\n'),
  );

  if (facadeContent !== null) {
    const actualFacade = normalizeWhitespace(stripTypeScriptComments(facadeContent));
    if (actualFacade !== expectedFacade) {
      errors.push(
        `${REPO_OBSERVABILITY_FACADE_PATH}: repoObservability.ts must remain a four-export facade to ./repoObservability/index`,
      );
    }
  }

  if (indexContent !== null) {
    const actualIndex = normalizeWhitespace(stripTypeScriptComments(indexContent));
    if (actualIndex !== expectedIndex) {
      errors.push(
        `${REPO_OBSERVABILITY_INDEX_PATH}: repoObservability/index.ts must remain a four-export public barrel`,
      );
    }
  }

  return errors;
}

function repoObservabilityExportModule(exportName: string): string {
  switch (exportName) {
    case 'probePidLiveness':
      return 'sessionHealth';
    case 'inferGuardrailIdentity':
      return 'guardrails';
    case 'readQueueStatusSnapshot':
      return 'queueSnapshot';
    case 'readObservabilitySnapshot':
      return 'snapshot';
    default:
      return 'index';
  }
}

async function validateRepoObservabilityInternalImports(root: string): Promise<string[]> {
  const electronDir = path.join(root, 'src', 'frontend', 'desktop', 'electron');
  try {
    await fs.promises.access(electronDir);
  } catch {
    return [];
  }

  const errors: string[] = [];
  const repoObservabilityInternalImport = /from\s+['"]\.\.?\/repoObservability\/[^'"]+['"]/u;

  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = normalizeStructureRelativePath(path.relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (
          relativePath === REPO_OBSERVABILITY_DIR_PATH ||
          relativePath.includes('/__tests__')
        ) {
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue;
      }
      if (relativePath === REPO_OBSERVABILITY_FACADE_PATH) {
        continue;
      }
      const content = await readOptionalFile(absolutePath);
      if (content && repoObservabilityInternalImport.test(stripTypeScriptComments(content))) {
        errors.push(
          `${relativePath}: production code outside repoObservability must import the public ./repoObservability facade, not internal modules`,
        );
      }
    }
  }

  await visit(electronDir);
  return errors;
}

export function normalizeStructureRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

async function validateRepoObservabilityArchitecture(root: string): Promise<string[]> {
  const [facadeErrors, internalImportErrors] = await Promise.all([
    validateRepoObservabilityFacade(root),
    validateRepoObservabilityInternalImports(root),
  ]);
  return [...facadeErrors, ...internalImportErrors];
}

// Guards the post-refactor Electron-root boundary: only allowlisted root files, ownership folders,
// and test files may sit directly at the Electron root. Any other production .ts/.tsx at the root
// is a regression of the directory cleanup and is rejected with the folder to use. Skips silently
// when the Electron directory is absent (e.g. minimal synthetic structure fixtures).
async function validateElectronRootBoundary(root: string): Promise<string[]> {
  const electronDir = path.join(root, ELECTRON_DIR_PATH);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(electronDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!/\.tsx?$/u.test(name) || /\.test\.tsx?$/u.test(name)) {
      continue;
    }
    if (ELECTRON_ROOT_ALLOWED_FILES.has(name)) {
      continue;
    }
    errors.push(
      `${ELECTRON_DIR_PATH}/${name}: new Electron production modules must live in an ownership ` +
        `folder (any Electron subdirectory), not at the Electron root. This rule only restricts ` +
        `loose files at the root; adding new ownership folders is always allowed. If this is a ` +
        `genuinely shared root utility, add it to ELECTRON_ROOT_ALLOWED_FILES in structure.ts.`,
    );
  }
  return errors;
}

// Rejects a stray production module added at the React renderer root. A loose .ts/.tsx file there
// is a regression of the directory cleanup and is rejected with the ownership folders to use. Skips
// silently when the renderer directory is absent (e.g. minimal synthetic structure fixtures).
async function validateRendererRootBoundary(root: string): Promise<string[]> {
  const rendererDir = path.join(root, RENDERER_DIR_PATH);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(rendererDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!/\.tsx?$/u.test(name) || /\.test\.tsx?$/u.test(name)) {
      continue;
    }
    if (RENDERER_ROOT_ALLOWED_FILES.has(name)) {
      continue;
    }
    errors.push(
      `${RENDERER_DIR_PATH}/${name}: new renderer production modules must live in an ownership ` +
        `folder (any renderer subdirectory), not at the renderer root. This rule only restricts ` +
        `loose files at the root; adding new ownership folders is always allowed. If this is a ` +
        `genuinely frozen root file, add it to RENDERER_ROOT_ALLOWED_FILES in structure.ts.`,
    );
  }
  return errors;
}

// Rejects a stray module added at the platform TypeScript root. The platform layer is organized as
// module folders; a loose .ts/.tsx file there is a regression of that discipline and is rejected with
// guidance to use a module folder. Skips silently when the platform directory is absent (e.g. minimal
// synthetic structure fixtures).
async function validatePlatformRootBoundary(root: string): Promise<string[]> {
  const platformDir = path.join(root, PLATFORM_DIR_PATH);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(platformDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!/\.tsx?$/u.test(name) || /\.test\.tsx?$/u.test(name)) {
      continue;
    }
    if (PLATFORM_ROOT_ALLOWED_FILES.has(name)) {
      continue;
    }
    errors.push(
      `${PLATFORM_DIR_PATH}/${name}: new platform modules must live in a module folder (any platform ` +
        `subdirectory), not at the platform root. This rule only restricts loose files at the root; ` +
        `adding new module folders is always allowed. If this is genuine root-level test tooling, add ` +
        `it to PLATFORM_ROOT_ALLOWED_FILES in structure.ts.`,
    );
  }
  return errors;
}

async function validateScriptsPythonRootBoundary(root: string): Promise<string[]> {
  const scriptsPythonDir = path.join(root, SCRIPTS_PYTHON_DIR_PATH);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(scriptsPythonDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!name.endsWith('.py')) {
      continue;
    }
    if (SCRIPTS_PYTHON_ROOT_ALLOWED_FILES.has(name)) {
      continue;
    }
    errors.push(
      `${SCRIPTS_PYTHON_DIR_PATH}/${name}: new scripts/python root files must be ` +
        `genuine operator entrypoints added to SCRIPTS_PYTHON_ROOT_ALLOWED_FILES or live ` +
        `under lib/ as reusable Python library code. Do not add loose helper modules at ` +
        `the scripts/python root.`,
    );
  }
  return errors;
}

async function validateMcpRootBoundary(root: string): Promise<string[]> {
  const mcpDir = path.join(root, MCP_DIR_PATH);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(mcpDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const errors: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    if (!name.endsWith('.py')) {
      continue;
    }
    if (MCP_ROOT_ALLOWED_FILES.has(name)) {
      continue;
    }
    errors.push(
      `${MCP_DIR_PATH}/${name}: new mcp modules must live in a module folder ` +
        `(pack/, probes/, workspace_context_sync/, context_estate/, repo_context_mcp/, ` +
        `pack_schemas/, or another focused subpackage), not at the mcp root. If this is ` +
        `a genuine package marker, add it to MCP_ROOT_ALLOWED_FILES in structure.ts.`,
    );
  }
  return errors;
}

export async function validateStructure(repoRoot?: string): Promise<StructureResult> {
  const root = repoRoot ?? await findRepoRoot();
  const requiredDirs = getRequiredDirs(root);
  const requiredFiles = getRequiredFiles(root);

  async function checkDir(dir: string): Promise<string | null> {
    try {
      const stat = await fs.promises.stat(path.join(root, dir));
      return stat.isDirectory() ? null : `Expected directory but found file: ${dir}`;
    } catch {
      return `Missing required directory: ${dir}`;
    }
  }

  async function checkFile(file: string): Promise<string | null> {
    try {
      const stat = await fs.promises.stat(path.join(root, file));
      return stat.isFile() ? null : `Expected file but found directory: ${file}`;
    } catch {
      return `Missing required file: ${file}`;
    }
  }

  const [
    thinWrapperErrors,
    repoObservabilityErrors,
    rootBoundaryErrors,
    rendererRootBoundaryErrors,
    platformRootBoundaryErrors,
    scriptsPythonRootBoundaryErrors,
    mcpRootBoundaryErrors,
    ...results
  ] = await Promise.all([
    validateElectronMainThinWrapper(root),
    validateRepoObservabilityArchitecture(root),
    validateElectronRootBoundary(root),
    validateRendererRootBoundary(root),
    validatePlatformRootBoundary(root),
    validateScriptsPythonRootBoundary(root),
    validateMcpRootBoundary(root),
    ...requiredDirs.map(checkDir),
    ...requiredFiles.map(checkFile),
  ]);

  const errors = [
    ...thinWrapperErrors,
    ...repoObservabilityErrors,
    ...rootBoundaryErrors,
    ...rendererRootBoundaryErrors,
    ...platformRootBoundaryErrors,
    ...scriptsPythonRootBoundaryErrors,
    ...mcpRootBoundaryErrors,
    ...results.filter((message): message is string => message !== null),
  ];
  return { valid: errors.length === 0, errors };
}
