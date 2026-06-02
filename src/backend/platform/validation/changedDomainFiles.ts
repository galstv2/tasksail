#!/usr/bin/env node

/**
 * Cross-platform changed-domain test lane.
 *
 * Replaces the Bash-only `git diff --name-only` + mapfile discovery so the lane
 * runs identically on Ubuntu, macOS, and Windows runners. Discovers changed
 * files via git (argv arrays, no shell), or from explicit repeatable
 * `--changed-path` inputs for local/test use, then routes them through
 * `run-targeted-tests.py` against `tests/test_manifest.json` so the workflow and
 * local checks agree on which Python domains run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../core/paths.js';
import { detectPythonBin } from '../core/pythonRunner.js';
import { runCliBoundary } from '../core/cliBoundary.js';
import { writeProtocolStderr, writeProtocolStdout } from '../core/protocolOutput.js';

const RUN_TARGETED_TESTS_REL = 'src/backend/scripts/python/run-targeted-tests.py';
const DEFAULT_MANIFEST_REL = 'tests/test_manifest.json';
const NO_MODULES_MARKER = 'No test modules were selected by the provided selectors.';

export type GitRunner = (args: string[], cwd: string) => string;

function defaultGitRunner(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

function dedupeNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

export interface DiscoverChangedFilesOptions {
  cwd: string;
  baseSha?: string;
  headSha?: string;
  /** Explicit changed paths (repeatable --changed-path); win over git discovery. */
  explicitPaths?: string[];
  gitRunner?: GitRunner;
}

/**
 * Explicit `--changed-path` inputs win (used by local runs and tests). Otherwise
 * `git diff --name-only <base> <head>` is invoked via argv arrays.
 */
export function discoverChangedFiles(options: DiscoverChangedFilesOptions): string[] {
  if (options.explicitPaths && options.explicitPaths.length > 0) {
    return dedupeNonEmpty(options.explicitPaths);
  }
  if (!options.baseSha || !options.headSha) {
    return [];
  }
  const runner = options.gitRunner ?? defaultGitRunner;
  const output = runner(['diff', '--name-only', options.baseSha, options.headSha], options.cwd);
  return dedupeNonEmpty(output.split(/\r?\n/));
}

export interface TargetedTestArgsOptions {
  scriptPath: string;
  manifestPath: string;
  changedFiles: string[];
  resolveOnly: boolean;
}

export function buildTargetedTestArgs(options: TargetedTestArgsOptions): string[] {
  const args = [options.scriptPath, '--manifest', options.manifestPath];
  if (options.resolveOnly) {
    args.push('--resolve-only');
  }
  for (const file of options.changedFiles) {
    args.push('--changed-path', file);
  }
  return args;
}

interface ParsedArgs {
  baseSha?: string;
  headSha?: string;
  manifest: string;
  changedPaths: string[];
}

export function parseChangedDomainArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { manifest: DEFAULT_MANIFEST_REL, changedPaths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-sha') {
      parsed.baseSha = argv[++i];
    } else if (arg === '--head-sha') {
      parsed.headSha = argv[++i];
    } else if (arg === '--manifest') {
      parsed.manifest = argv[++i] ?? DEFAULT_MANIFEST_REL;
    } else if (arg === '--changed-path') {
      const value = argv[++i];
      if (value) {
        parsed.changedPaths.push(value);
      }
    }
  }
  return parsed;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const parsed = parseChangedDomainArgs(process.argv.slice(2));

  const changedFiles = discoverChangedFiles({
    cwd: repoRoot,
    baseSha: parsed.baseSha,
    headSha: parsed.headSha,
    explicitPaths: parsed.changedPaths,
  });

  if (changedFiles.length === 0) {
    writeProtocolStdout('No changed files detected for the changed-domain lane.\n');
    return;
  }

  const python = detectPythonBin(repoRoot);
  const scriptPath = path.join(repoRoot, RUN_TARGETED_TESTS_REL);
  const manifestPath = path.isAbsolute(parsed.manifest)
    ? parsed.manifest
    : path.join(repoRoot, parsed.manifest);

  // Phase 1: resolve-only to detect "no manifest-mapped domains" (treated as a
  // pass — there is simply nothing to run for these paths).
  const resolveArgs = buildTargetedTestArgs({ scriptPath, manifestPath, changedFiles, resolveOnly: true });
  const resolved = spawnSync(python, resolveArgs, { cwd: repoRoot, encoding: 'utf-8' });
  const resolvedOutput = `${resolved.stdout ?? ''}${resolved.stderr ?? ''}`;
  if (resolved.error) {
    writeProtocolStderr(`Failed to run run-targeted-tests.py: ${resolved.error.message}\n`);
    process.exit(1);
  }
  if (resolved.status !== 0) {
    if (resolvedOutput.includes(NO_MODULES_MARKER)) {
      writeProtocolStdout('No manifest-mapped domains matched the changed files.\n');
      return;
    }
    writeProtocolStderr(resolvedOutput);
    process.exit(resolved.status ?? 1);
  }
  writeProtocolStdout(`Resolved changed-path modules:\n${resolvedOutput}\n`);

  // Phase 2: run the targeted tests with inherited stdio so output streams.
  const runArgs = buildTargetedTestArgs({ scriptPath, manifestPath, changedFiles, resolveOnly: false });
  const run = spawnSync(python, runArgs, { cwd: repoRoot, stdio: 'inherit' });
  if (run.error) {
    writeProtocolStderr(`Failed to run run-targeted-tests.py: ${run.error.message}\n`);
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  runCliBoundary('platform/validation/changedDomainFiles', main);
}
