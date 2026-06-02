import { mkdir, readFile, writeFile, rename, copyFile, unlink } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Ensure a directory exists, creating it and all parents if needed.
 */
export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

/**
 * Read a file as UTF-8 text. Returns undefined if the file does not exist.
 */
export async function readTextFile(
  filePath: string,
): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

/**
 * Write text content to a file, creating parent directories if needed.
 */
export async function writeTextFile(
  filePath: string,
  content: string,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Atomically write text content to a file using a temp file + rename.
 *
 * The temp name uses a cryptographically random suffix and is created with an
 * exclusive `wx` flag, so concurrent or rapid same-process writes can never
 * collide on the same temp path (a pid+millisecond name could). On the rare
 * EEXIST it retries with a fresh suffix. The destination file, encoding, and
 * serialization are unchanged — only temp naming and write atomicity differ.
 * Cleanup only ever removes the temp path this call created.
 */
export async function writeTextFileAtomic(
  filePath: string,
  content: string,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const maxAttempts = 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(8).toString('hex')}`;
    try {
      // `wx` fails if the temp path already exists, so we never clobber a temp
      // file owned by a concurrent writer.
      await writeFile(tmpPath, content, { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        lastError = err;
        continue;
      }
      throw err;
    }
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (err) {
      await unlinkQuiet(tmpPath);
      throw err;
    }
  }
  throw new Error(
    `writeTextFileAtomic: could not allocate a unique temp file for ${filePath} after ${maxAttempts} attempts`,
    { cause: lastError },
  );
}

async function unlinkQuiet(targetPath: string): Promise<void> {
  try {
    await unlink(targetPath);
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Move a file from one location to another.
 * Creates the destination directory if it does not exist.
 */
export async function moveFile(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    const { unlink } = await import('node:fs/promises');
    await unlink(src);
  }
}

/**
 * Copy a file to a new location.
 * Creates the destination directory if it does not exist.
 */
export async function copyFileSafe(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  await copyFile(src, dest);
}

/**
 * Create a temporary directory with an optional prefix.
 * Returns the absolute path of the created directory.
 */
export function createTempDir(prefix = 'platform-'): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/**
 * Create a temporary file path inside a temp directory.
 * The file is not actually created — only the path is returned.
 */
export function tempFilePath(filename: string, prefix = 'platform-'): string {
  const dir = createTempDir(prefix);
  return path.join(dir, filename);
}

/**
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse JSON with a contextual error message on failure.
 * Replaces bare JSON.parse calls that produce opaque "Unexpected token" errors.
 */
export function safeJsonParse<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    const isError = cause instanceof Error;
    throw new Error(
      `Invalid JSON in ${context}: ${isError ? cause.message : String(cause)}`,
      { cause: isError ? cause : undefined },
    );
  }
}
