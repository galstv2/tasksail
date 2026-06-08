import fs, { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, open, readdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  AgentInstructionsListFilesRequest,
  AgentInstructionsListFilesResponse,
  AgentInstructionsReadFileRequest,
  AgentInstructionsReadFileResponse,
  AgentInstructionsWriteFileRequest,
  AgentInstructionsWriteFileResponse,
  DesktopInvokeResult,
  InstructionDirectory,
  InstructionFileEntry,
} from '../../src/shared/desktopContract';
import { getActiveProvider } from '../../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from '../paths';

type FileSystemAdapter = {
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  readDir: (dirPath: string, options: { withFileTypes: true }) => Promise<fs.Dirent[]>;
  lstat: (filePath: string) => Promise<Stats>;
  open: (filePath: string, flags: number) => Promise<fs.promises.FileHandle>;
  realpath: (filePath: string) => Promise<string>;
};

type AgentInstructionsHandlerOptions = {
  repoRoot?: string;
  fsAdapter?: FileSystemAdapter;
  now?: () => number;
};

const defaultFsAdapter: FileSystemAdapter = {
  readTextFile: (filePath) => readFile(filePath, 'utf-8'),
  writeTextFile: (filePath, contents) => writeFile(filePath, contents, 'utf-8'),
  rename: (sourcePath, destinationPath) => rename(sourcePath, destinationPath),
  readDir: (dirPath, options) => readdir(dirPath, options) as Promise<fs.Dirent[]>,
  lstat: (filePath) => lstat(filePath),
  open: (filePath, flags) => open(filePath, flags),
  realpath: (filePath) => realpath(filePath),
};

function buildDirectoryMap(repoRoot: string): Record<InstructionDirectory, string> {
  const providerPaths = getActiveProvider(repoRoot).agentConfigPaths();
  return {
    profiles: providerPaths.profiles,
    instructions: providerPaths.instructions,
    prompts: providerPaths.prompts,
    templates: 'AgentWorkSpace/templates',
  };
}

/**
 * Enumerate live allowlisted instruction files from the given directory.
 * Returns normalized repo-relative paths (forward slashes).
 * Rejects symlinked directories and skips symlinked entries.
 */
async function enumerateAllowedFiles(
  directory: InstructionDirectory,
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
): Promise<InstructionFileEntry[]> {
  const relativeDir = buildDirectoryMap(repoRoot)[directory];
  const absoluteDir = path.join(repoRoot, relativeDir);

  // Reject symlinked directories; also ensure the resolved path stays under repoRoot.
  try {
    const dirStat = await fsAdapter.lstat(absoluteDir);
    if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return [];
    }
    const resolvedDir = await fsAdapter.realpath(absoluteDir);
    const resolvedRoot = await fsAdapter.realpath(repoRoot);
    if (!resolvedDir.startsWith(resolvedRoot + path.sep) && resolvedDir !== resolvedRoot) {
      return [];
    }
  } catch {
    return [];
  }

  let dirents: fs.Dirent[];
  try {
    dirents = await fsAdapter.readDir(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const mdFiles: string[] = [];
  for (const entry of dirents) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) {
      continue;
    }
    // Dirent.isFile() returns false for symlinks, so this already filters them out.
    // Confirm with an explicit lstat to be safe against withFileTypes edge cases.
    try {
      const entryStat = await fsAdapter.lstat(path.join(absoluteDir, entry.name));
      if (!entryStat.isFile() || entryStat.isSymbolicLink()) {
        continue;
      }
    } catch {
      continue;
    }
    mdFiles.push(entry.name);
  }

  mdFiles.sort();
  return mdFiles.map((fileName) => ({
    fileName,
    relativePath: `${relativeDir}/${fileName}`,
  }));
}

/**
 * Validate that a relativePath is an exact member of the live allowlisted
 * file set for the appropriate directory. Returns the matching entry if valid.
 */
async function validateAllowlistedPath(
  relativePath: string,
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
): Promise<{ valid: true; entry: InstructionFileEntry; directory: InstructionDirectory } | { valid: false; reason: string }> {
  if (relativePath.includes('..')) {
    return { valid: false, reason: 'Path traversal is not allowed.' };
  }
  if (!relativePath.endsWith('.md')) {
    return { valid: false, reason: 'Only .md files may be accessed.' };
  }

  // Determine which directory the path belongs to
  let matchedDirectory: InstructionDirectory | null = null;
  for (const [dir, prefix] of Object.entries(buildDirectoryMap(repoRoot))) {
    if (relativePath.startsWith(`${prefix}/`)) {
      matchedDirectory = dir as InstructionDirectory;
      break;
    }
  }

  if (!matchedDirectory) {
    return { valid: false, reason: 'Path is not under an allowed instruction directory.' };
  }

  // Enumerate the live file set and check for an exact match
  const allowedFiles = await enumerateAllowedFiles(matchedDirectory, repoRoot, fsAdapter);
  const match = allowedFiles.find((f) => f.relativePath === relativePath);

  if (!match) {
    return { valid: false, reason: 'File is not in the live allowlisted set.' };
  }

  // Verify the file actually exists on disk and is a non-symlink regular file
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    const fileStat = await fsAdapter.lstat(absolutePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { valid: false, reason: 'Path does not reference a regular file.' };
    }
  } catch {
    return { valid: false, reason: 'File does not exist on disk.' };
  }

  return { valid: true, entry: match, directory: matchedDirectory };
}

export async function listInstructionFiles(
  request: AgentInstructionsListFilesRequest,
  options: AgentInstructionsHandlerOptions = {},
): Promise<DesktopInvokeResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fsAdapter = options.fsAdapter ?? defaultFsAdapter;

  try {
    const files = await enumerateAllowedFiles(request.payload.directory, repoRoot, fsAdapter);
    const response: AgentInstructionsListFilesResponse = {
      action: 'agentInstructions.listFiles',
      mode: 'read-only',
      message: `${files.length} file(s) in ${request.payload.directory}.`,
      files,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to list instruction files: ${detail}` };
  }
}

function identityMatches(before: Stats, after: Stats): boolean {
  if (before.dev === 0 || after.dev === 0 || before.ino === 0 || after.ino === 0) {
    return false;
  }
  return before.dev === after.dev && before.ino === after.ino;
}

export async function readInstructionFile(
  request: AgentInstructionsReadFileRequest,
  options: AgentInstructionsHandlerOptions = {},
): Promise<DesktopInvokeResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fsAdapter = options.fsAdapter ?? defaultFsAdapter;
  let handle: fs.promises.FileHandle | undefined;

  try {
    const validation = await validateAllowlistedPath(request.payload.relativePath, repoRoot, fsAdapter);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    const absolutePath = path.join(repoRoot, validation.entry.relativePath);

    // Re-lstat immediately before open to get a reference identity for TOCTOU detection.
    const beforeOpenStat = await fsAdapter.lstat(absolutePath);
    if (!beforeOpenStat.isFile() || beforeOpenStat.isSymbolicLink()) {
      return { ok: false, error: 'File changed before open.' };
    }

    // Open with O_NOFOLLOW to refuse symlinks at the kernel level where available.
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    handle = await fsAdapter.open(absolutePath, fsConstants.O_RDONLY | noFollow);

    // Post-open identity check: verify the opened inode matches the pre-open lstat.
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || !identityMatches(beforeOpenStat, openedStat)) {
      return { ok: false, error: 'File changed while opening.' };
    }

    // Read from the identity-verified descriptor, NOT by re-opening the path: a path
    // re-open would re-follow a symlink swapped in after the post-open identity check
    // (the TOCTOU window), leaking files outside the instruction allowlist.
    const content = await handle.readFile('utf-8');

    const response: AgentInstructionsReadFileResponse = {
      action: 'agentInstructions.readFile',
      mode: 'read-only',
      message: `Read ${validation.entry.fileName}.`,
      fileName: validation.entry.fileName,
      relativePath: validation.entry.relativePath,
      content,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to read instruction file: ${detail}` };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeInstructionFile(
  request: AgentInstructionsWriteFileRequest,
  options: AgentInstructionsHandlerOptions = {},
): Promise<DesktopInvokeResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fsAdapter = options.fsAdapter ?? defaultFsAdapter;
  const now = options.now ?? Date.now;

  try {
    const validation = await validateAllowlistedPath(request.payload.relativePath, repoRoot, fsAdapter);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    const absolutePath = path.join(repoRoot, validation.entry.relativePath);

    // Re-check symlink-aware metadata immediately before writing (TOCTOU guard).
    const preWriteStat = await fsAdapter.lstat(absolutePath);
    if (!preWriteStat.isFile() || preWriteStat.isSymbolicLink()) {
      return { ok: false, error: 'File changed before write.' };
    }

    // Temp file stays in the same validated directory (same filesystem for atomic rename).
    const tempPath = `${absolutePath}.tmp-${process.pid}-${now()}`;

    // Create the temp file fail-closed: O_EXCL refuses a pre-planted temp path and
    // O_NOFOLLOW refuses a symlink there, so a predicted-temp-name symlink swap cannot
    // redirect this write outside the validated directory. Then atomically rename.
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const tempHandle = await fsAdapter.open(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    );
    try {
      await tempHandle.writeFile(request.payload.content, 'utf-8');
    } finally {
      await tempHandle.close().catch(() => undefined);
    }
    await fsAdapter.rename(tempPath, absolutePath);

    const response: AgentInstructionsWriteFileResponse = {
      action: 'agentInstructions.writeFile',
      mode: 'mutated',
      message: `Saved ${validation.entry.fileName}.`,
      fileName: validation.entry.fileName,
      relativePath: validation.entry.relativePath,
    };
    return { ok: true, response };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to write instruction file: ${detail}` };
  }
}
