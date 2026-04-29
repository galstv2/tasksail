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
  'docker',
  'podman',
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

  const results = await Promise.all([
    ...requiredDirs.map(checkDir),
    ...requiredFiles.map(checkFile),
  ]);

  const errors = results.filter((message): message is string => message !== null);
  return { valid: errors.length === 0, errors };
}
