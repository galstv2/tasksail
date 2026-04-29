import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
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
} from '../src/shared/desktopContract';
import { getActiveProvider } from '../../../backend/platform/cli-provider/index.js';
import { REPO_ROOT } from './paths';

type FileSystemAdapter = {
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  readDir: (dirPath: string) => Promise<string[]>;
  stat: (filePath: string) => Promise<{ isFile: () => boolean }>;
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
  readDir: (dirPath) => readdir(dirPath),
  stat: (filePath) => stat(filePath),
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
 * Enumerate live allowlisted `.md` files from the given instruction directory.
 * Returns normalized repo-relative paths (forward slashes).
 */
async function enumerateAllowedFiles(
  directory: InstructionDirectory,
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
): Promise<InstructionFileEntry[]> {
  const relativeDir = buildDirectoryMap(repoRoot)[directory];
  const absoluteDir = path.join(repoRoot, relativeDir);

  let entries: string[];
  try {
    entries = await fsAdapter.readDir(absoluteDir);
  } catch {
    return [];
  }

  const mdFiles = entries
    .filter((name) => name.endsWith('.md'))
    .sort();

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

  // Verify the file actually exists on disk
  const absolutePath = path.join(repoRoot, relativePath);
  try {
    const fileStat = await fsAdapter.stat(absolutePath);
    if (!fileStat.isFile()) {
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

export async function readInstructionFile(
  request: AgentInstructionsReadFileRequest,
  options: AgentInstructionsHandlerOptions = {},
): Promise<DesktopInvokeResult> {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fsAdapter = options.fsAdapter ?? defaultFsAdapter;

  try {
    const validation = await validateAllowlistedPath(request.payload.relativePath, repoRoot, fsAdapter);
    if (!validation.valid) {
      return { ok: false, error: validation.reason };
    }

    const absolutePath = path.join(repoRoot, validation.entry.relativePath);
    const content = await fsAdapter.readTextFile(absolutePath);

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
    const tempPath = `${absolutePath}.tmp-${process.pid}-${now()}`;

    // Atomic write: write to temp file then rename
    await fsAdapter.writeTextFile(tempPath, request.payload.content);
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
