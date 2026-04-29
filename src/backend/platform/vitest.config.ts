import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const DEFAULT_MAX_WORKERS = 4;
const HARD_MAX_WORKERS = 8;

function resolveMaxWorkers(): number {
  const parsed = Number(process.env.TASKSAIL_VITEST_MAX_WORKERS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_WORKERS;
  return Math.min(Math.floor(parsed), HARD_MAX_WORKERS);
}

const MAX_WORKERS = resolveMaxWorkers();
const childGuardPath = fileURLToPath(
  new URL('./vitest.childProcessGuard.ts', import.meta.url),
);

export default defineConfig({
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    setupFiles: [childGuardPath],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: MAX_WORKERS,
        minForks: 1,
        execArgv: ['--max-old-space-size=1536'],
      },
    },
  },
});
