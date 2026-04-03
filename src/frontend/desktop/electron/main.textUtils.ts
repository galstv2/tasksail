import { relative } from 'node:path';
import { REPO_ROOT } from './paths';

export function toRepoRelativePath(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');
}

export function getNodeErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }

  return null;
}

/**
 * Parse structured JSON error from Python script stderr.
 * Returns extracted errorCode and message if the stderr matches the expected code.
 */
export function parseStderrErrorCode(
  stderr: string,
  expectedCode: string,
): { errorCode: string; errorMessage: string } | null {
  try {
    const parsed = JSON.parse(stderr);
    if (parsed.error === expectedCode) {
      return { errorCode: expectedCode, errorMessage: parsed.message || stderr };
    }
  } catch {
    // stderr was not JSON
  }
  return null;
}

export function stripMarkdownComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '').trim();
}
