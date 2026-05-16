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

const ELECTRON_MAIN_PATH = path.join('src', 'frontend', 'desktop', 'electron', 'main.ts');
const REPO_OBSERVABILITY_FACADE_PATH = path.join(
  'src',
  'frontend',
  'desktop',
  'electron',
  'repoObservability.ts',
);
const REPO_OBSERVABILITY_INDEX_PATH = path.join(
  'src',
  'frontend',
  'desktop',
  'electron',
  'repoObservability',
  'index.ts',
);

const REPO_OBSERVABILITY_PUBLIC_EXPORTS = [
  'probePidLiveness',
  'inferGuardrailIdentity',
  'readQueueStatusSnapshot',
  'readObservabilitySnapshot',
] as const;

const ELECTRON_MAIN_FORBIDDEN_PATTERNS: ThinWrapperForbiddenPattern[] = [
  {
    pattern: /\bipcMain\.handle\s*\(/,
    message: 'main.ts must not register IPC handlers; use main.ipcContract.ts',
  },
  {
    pattern: /\bnew\s+BrowserWindow\s*\(/,
    message: 'main.ts must not construct BrowserWindow; use main.windowManager.ts',
  },
  {
    pattern: /\bswitch\s*\(\s*request\.action\s*\)/,
    message: 'main.ts must not contain the desktop action switch; use main.desktopActionRouter.ts',
  },
  {
    pattern: /\b(?:type|interface)\s+DesktopActionHandlers\b/,
    message: 'main.ts must not define DesktopActionHandlers; use main.desktopActionHandlers.ts',
  },
  {
    pattern: /\bconst\s+defaultDesktopActionHandlers\b/,
    message: 'main.ts must not define default desktop action handlers; use main.desktopActionHandlers.ts',
  },
  {
    pattern: /\bstartRuntimeStreamWatcher\s*\(/,
    message: 'main.ts must not start the runtime stream watcher directly; use main.appController.ts',
  },
  {
    pattern: /\bstartTaskBoardWatcher\s*\(/,
    message: 'main.ts must not start the task board watcher directly; use main.appController.ts',
  },
  {
    pattern: /\bstartTaskRecoveryController\s*\(/,
    message: 'main.ts must not start task recovery directly; use main.appController.ts',
  },
  {
    pattern: /\bcleanupStalePipelineState\s*\(/,
    message: 'main.ts must not run startup recovery cleanup directly; use main.startupRecovery.ts',
  },
  {
    pattern: /\bschedulePipelineAutoStart\s*\(/,
    message: 'main.ts must not auto-start pipelines directly; use main.startupRecovery.ts',
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
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (
          relativePath === 'src/frontend/desktop/electron/repoObservability' ||
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

async function validateRepoObservabilityArchitecture(root: string): Promise<string[]> {
  const [facadeErrors, internalImportErrors] = await Promise.all([
    validateRepoObservabilityFacade(root),
    validateRepoObservabilityInternalImports(root),
  ]);
  return [...facadeErrors, ...internalImportErrors];
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

  const [thinWrapperErrors, repoObservabilityErrors, ...results] = await Promise.all([
    validateElectronMainThinWrapper(root),
    validateRepoObservabilityArchitecture(root),
    ...requiredDirs.map(checkDir),
    ...requiredFiles.map(checkFile),
  ]);

  const errors = [
    ...thinWrapperErrors,
    ...repoObservabilityErrors,
    ...results.filter((message): message is string => message !== null),
  ];
  return { valid: errors.length === 0, errors };
}
