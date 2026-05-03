import { spawn, type ChildProcess } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readFile as fsReadFile, readdir as fsReadDir, realpath as fsRealPath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import type {
  ContextPackCatalogEntry,
  ContextPackListRepoTreePayload,
  ContextPackListRepoTreeResponse,
  ContextPackRepoTreeEntry,
  DesktopInvokeResult,
} from '../src/shared/desktopContract';

import { REPO_ROOT } from './paths';
import { listAvailableContextPacks } from './main.contextPackCatalog';

const TREE_ENTRY_LIMIT = 500;
const OPERATOR_IGNORE_PATH = '.platform-state/deep-focus-ignore.json';

export const CONTEXT_PACK_TREE_STATIC_DENY_LIST = [
  '.git',
  '.platform-state',
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'coverage',
  'vendor',
  '.venv',
  '.tox',
  '.mypy_cache',
  '.ruff_cache',
  // macOS — Finder/Spotlight/system metadata that is never legitimate source content.
  '.DS_Store',
  '.AppleDouble',
  '.LSOverride',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  '.DocumentRevisions-V100',
  '.TemporaryItems',
  '.AppleDB',
  '.AppleDesktop',
  '.apdisk',
  // Windows — Explorer/Recycler/index metadata.
  'Thumbs.db',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  'desktop.ini',
  '$RECYCLE.BIN',
  'System Volume Information',
  // Linux/KDE.
  '.directory',
] as const;

type TreeDirent = Dirent;

type RepoTreeDependencies = {
  readdir?: (path: string, options: { withFileTypes: true }) => Promise<TreeDirent[]>;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  realpath?: (path: string) => Promise<string>;
  checkIgnoredPaths?: (repoLocalPath: string, candidatePaths: readonly string[]) => Promise<Set<string> | null>;
  catalogProvider?: typeof listAvailableContextPacks;
};

type DeepFocusIgnoreConfig = {
  extensions: string[];
  patterns: string[];
};

function normalizeRelativePath(relativePath?: string): string | null {
  if (relativePath === undefined) {
    return '';
  }

  const trimmed = relativePath.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const portablePath = trimmed.replaceAll('\\', '/');
  if (
    portablePath.startsWith('/')
    || portablePath.startsWith('~/')
    || /^[A-Za-z]:\//.test(portablePath)
  ) {
    return null;
  }

  const normalizedSegments: string[] = [];
  for (const segment of portablePath.split('/')) {
    if (segment.length === 0 || segment === '.') {
      continue;
    }
    if (segment === '..') {
      return null;
    }
    normalizedSegments.push(segment);
  }

  return normalizedSegments.join('/');
}

function joinRepoRelativePath(parentPath: string, entryName: string): string {
  return parentPath.length > 0 ? `${parentPath}/${entryName}` : entryName;
}

function compareTreeEntries(left: ContextPackRepoTreeEntry, right: ContextPackRepoTreeEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === 'directory' ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

async function canonicalizePath(
  targetPath: string,
  realpath: (path: string) => Promise<string>,
): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    return resolve(targetPath);
  }
}

function collectCatalogRepoLocalPaths(
  contextPacks: readonly ContextPackCatalogEntry[],
  activeContextPackDir: string | null,
): string[] {
  const preferredPack = activeContextPackDir
    ? contextPacks.find((entry) => entry.contextPackDir === activeContextPackDir)
    : undefined;
  const candidatePacks = preferredPack ? [preferredPack] : contextPacks;
  const seen = new Set<string>();
  const repoLocalPaths: string[] = [];

  for (const pack of candidatePacks) {
    for (const target of pack.focusTargets) {
      if (!target.repoLocalPath) {
        continue;
      }
      const normalizedPath = resolve(target.repoLocalPath);
      if (seen.has(normalizedPath)) {
        continue;
      }
      seen.add(normalizedPath);
      repoLocalPaths.push(normalizedPath);
    }
  }

  return repoLocalPaths;
}

function escapeRegex(pattern: string): string {
  return pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function patternMatchesName(pattern: string, name: string): boolean {
  const regex = new RegExp(`^${escapeRegex(pattern).replaceAll('*', '.*')}$`);
  return regex.test(name);
}

function matchesOperatorIgnorePattern(
  entryName: string,
  entryKind: 'directory' | 'file',
  pattern: string,
): boolean {
  const directoryOnly = pattern.endsWith('/');
  const normalizedPattern = directoryOnly ? pattern.slice(0, -1) : pattern;
  if (normalizedPattern.length === 0) {
    return false;
  }
  if (directoryOnly && entryKind !== 'directory') {
    return false;
  }
  return patternMatchesName(normalizedPattern, entryName);
}

type GitignoreFallback = {
  ignore: string[];
  unignore: string[];
};

async function readRootGitignorePatterns(
  repoRoot: string,
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<GitignoreFallback> {
  let raw: string;
  try {
    raw = await readFile(resolve(repoRoot, '.gitignore'), 'utf-8');
  } catch {
    return { ignore: [], unignore: [] };
  }

  const ignore: string[] = [];
  const unignore: string[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;

    const isNegation = line.startsWith('!');
    let pattern = isNegation ? line.slice(1) : line;
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }
    // Path-anchored patterns (e.g. `src/build`) need full-path matching; we
    // only do name-segment matching, so skip these to avoid false negatives
    // and false positives. Trailing-slash-only keeps the directory semantic
    // for `matchesOperatorIgnorePattern`.
    const innerSlashIndex = pattern.slice(0, -1).indexOf('/');
    if (innerSlashIndex !== -1) continue;
    if (pattern.length === 0) continue;
    if (isNegation) {
      unignore.push(pattern);
    } else {
      ignore.push(pattern);
    }
  }
  return { ignore, unignore };
}

async function readOperatorIgnoreConfig(
  repoRoot: string,
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>,
): Promise<DeepFocusIgnoreConfig | null> {
  try {
    const raw = await readFile(resolve(repoRoot, OPERATOR_IGNORE_PATH), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const extensions = Array.isArray(parsed.extensions)
      ? parsed.extensions.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const patterns = Array.isArray(parsed.patterns)
      ? parsed.patterns.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    return { extensions, patterns };
  } catch {
    return null;
  }
}

async function checkIgnoredPathsWithGit(
  repoLocalPath: string,
  candidatePaths: readonly string[],
  spawnProcess: typeof spawn = spawn,
): Promise<Set<string> | null> {
  if (candidatePaths.length === 0) {
    return new Set();
  }

  return new Promise((resolvePromise) => {
    let resolved = false;
    const stdoutChunks: Buffer[] = [];
    const finish = (value: Set<string> | null): void => {
      if (!resolved) {
        resolved = true;
        resolvePromise(value);
      }
    };

    let child: ChildProcess;
    try {
      child = spawnProcess('git', ['check-ignore', '--stdin', '-z'], {
        cwd: repoLocalPath,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      finish(null);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        finish(null);
        return;
      }

      const ignoredPaths = Buffer.concat(stdoutChunks)
        .toString('utf-8')
        .split('\u0000')
        .filter((value) => value.length > 0);
      finish(new Set(ignoredPaths));
    });

    child.stdin?.on('error', () => finish(null));
    child.stdin?.end(`${candidatePaths.join('\u0000')}\u0000`);
  });
}

function buildEmptyTreeResponse(
  repoLocalPath: string,
  currentPath: string,
  message: string,
): ContextPackListRepoTreeResponse {
  return {
    action: 'contextPack.listRepoTree',
    mode: 'read-only',
    message,
    entries: [],
    currentPath,
    repoLocalPath,
    truncated: false,
  };
}

export async function executeContextPackListRepoTreeAction(
  payload: ContextPackListRepoTreePayload,
  dependencies: RepoTreeDependencies = {},
): Promise<DesktopInvokeResult> {
  const {
    readdir = (targetPath, options) => fsReadDir(targetPath, options),
    readFile = (targetPath, encoding) => fsReadFile(targetPath, encoding),
    realpath = (targetPath) => fsRealPath(targetPath),
    checkIgnoredPaths = checkIgnoredPathsWithGit,
    catalogProvider = listAvailableContextPacks,
  } = dependencies;

  if (!isAbsolute(payload.repoLocalPath)) {
    return {
      ok: true,
      response: buildEmptyTreeResponse(resolve(REPO_ROOT), '', 'Repo tree request rejected.'),
    };
  }

  const requestedCurrentPath = normalizeRelativePath(payload.relativePath);
  if (requestedCurrentPath === null) {
    return {
      ok: true,
      response: buildEmptyTreeResponse(resolve(payload.repoLocalPath), '', 'Repo tree request rejected.'),
    };
  }

  const catalog = await catalogProvider();
  const approvedRepoRoots = collectCatalogRepoLocalPaths(catalog.contextPacks, catalog.activeContextPackDir);
  const approvedRootSet = new Set(
    await Promise.all(approvedRepoRoots.map((repoRoot) => canonicalizePath(repoRoot, realpath))),
  );
  const canonicalRepoLocalPath = await canonicalizePath(payload.repoLocalPath, realpath);

  if (!approvedRootSet.has(canonicalRepoLocalPath)) {
    return {
      ok: true,
      response: buildEmptyTreeResponse(canonicalRepoLocalPath, '', 'Repo root is not approved for tree listing.'),
    };
  }

  const requestedDirectory = requestedCurrentPath.length === 0
    ? canonicalRepoLocalPath
    : resolve(canonicalRepoLocalPath, ...requestedCurrentPath.split('/'));

  const relativeToRoot = requestedDirectory.startsWith(`${canonicalRepoLocalPath}${sep}`)
    || requestedDirectory === canonicalRepoLocalPath;
  if (!relativeToRoot) {
    return {
      ok: true,
      response: buildEmptyTreeResponse(canonicalRepoLocalPath, '', 'Repo tree request rejected.'),
    };
  }

  let directoryEntries: TreeDirent[];
  try {
    directoryEntries = await readdir(requestedDirectory, { withFileTypes: true });
  } catch {
    return {
      ok: true,
      response: buildEmptyTreeResponse(
        canonicalRepoLocalPath,
        requestedCurrentPath,
        'Directory unavailable; returning an empty tree.',
      ),
    };
  }

  const denyList = new Set<string>(CONTEXT_PACK_TREE_STATIC_DENY_LIST);
  const candidateEntries = directoryEntries
    .filter((entry) => !denyList.has(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({
      name: entry.name,
      relativePath: joinRepoRelativePath(requestedCurrentPath, entry.name),
      kind: entry.isDirectory() ? 'directory' as const : 'file' as const,
      hasChildren: entry.isDirectory(),
    }));

  const ignoredByGit = await checkIgnoredPaths(
    canonicalRepoLocalPath,
    candidateEntries.map((entry) => entry.relativePath),
  );
  let gitFilteredEntries: typeof candidateEntries;
  if (ignoredByGit === null) {
    // Non-git folder (or git-check-ignore unavailable): apply our own
    // best-effort .gitignore parser so any rules in the repo root are still
    // honored. Negation (`!pattern`) un-ignores after the positive pass.
    const fallback = await readRootGitignorePatterns(canonicalRepoLocalPath, readFile);
    gitFilteredEntries = fallback.ignore.length === 0
      ? candidateEntries
      : candidateEntries.filter((entry) => {
        const ignored = fallback.ignore.some((pattern) =>
          matchesOperatorIgnorePattern(entry.name, entry.kind, pattern));
        if (!ignored) return true;
        const unignored = fallback.unignore.some((pattern) =>
          matchesOperatorIgnorePattern(entry.name, entry.kind, pattern));
        return unignored;
      });
  } else {
    gitFilteredEntries = candidateEntries.filter((entry) => !ignoredByGit.has(entry.relativePath));
  }

  const operatorIgnoreConfig = await readOperatorIgnoreConfig(canonicalRepoLocalPath, readFile);
  const filteredEntries = operatorIgnoreConfig === null
    ? gitFilteredEntries
    : gitFilteredEntries.filter((entry) => {
      if (
        entry.kind === 'file'
        && operatorIgnoreConfig.extensions.some((extension) => entry.name.endsWith(extension))
      ) {
        return false;
      }

      return !operatorIgnoreConfig.patterns.some((pattern) =>
        matchesOperatorIgnorePattern(entry.name, entry.kind, pattern));
    });

  filteredEntries.sort(compareTreeEntries);
  const truncated = filteredEntries.length > TREE_ENTRY_LIMIT;

  return {
    ok: true,
    response: {
      action: 'contextPack.listRepoTree',
      mode: 'read-only',
      message: truncated
        ? `Listed the first ${TREE_ENTRY_LIMIT} visible entries.`
        : 'Listed repo tree entries.',
      entries: filteredEntries.slice(0, TREE_ENTRY_LIMIT),
      currentPath: requestedCurrentPath,
      repoLocalPath: canonicalRepoLocalPath,
      truncated,
    },
  };
}
