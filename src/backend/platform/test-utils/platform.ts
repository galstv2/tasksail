import { it, expect } from 'vitest';
import path from 'node:path';
import { isWindowsPlatform, isWSL } from '../core/platform.js';

export const itWindowsOnly = isWindowsPlatform() ? it : it.skip;
export const itPosixOnly = isWindowsPlatform() ? it.skip : it;

export const itWSLOnly = isWSL() ? it : it.skip;

/**
 * Path equality assertion that tolerates host separator differences.
 * Builds the expected path using path.join (which honors the host sep),
 * so callers pass POSIX segments and the helper normalizes both sides.
 */
export function expectPathEqual(actual: string, ...segments: string[]): void {
  const expected = path.join(...segments);
  expect(path.normalize(actual)).toBe(path.normalize(expected));
}
