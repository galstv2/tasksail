import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot } from '../core/index.js';

export const REQUIRED_DIRS: string[] = [
  '.github/agents',
  '.github/copilot',
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

export const REQUIRED_FILES: string[] = [
  '.env.example',
  'Makefile',
  'CLAUDE.md',
];

export interface StructureResult {
  valid: boolean;
  errors: string[];
}

export async function validateStructure(repoRoot?: string): Promise<StructureResult> {
  const root = repoRoot ?? await findRepoRoot();
  const errors: string[] = [];

  for (const dir of REQUIRED_DIRS) {
    const fullPath = path.join(root, dir);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isDirectory()) {
        errors.push(`Expected directory but found file: ${dir}`);
      }
    } catch {
      errors.push(`Missing required directory: ${dir}`);
    }
  }

  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(root, file);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (!stat.isFile()) {
        errors.push(`Expected file but found directory: ${file}`);
      }
    } catch {
      errors.push(`Missing required file: ${file}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
