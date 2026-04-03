import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'Makefile')) && existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // In packaged builds there is no repo root — return the app directory itself.
  return startDir;
}

export const REPO_ROOT = findRepoRoot(currentDir);
export const DESKTOP_ROOT = join(REPO_ROOT, 'src/frontend/desktop');
