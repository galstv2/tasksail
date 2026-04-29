import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import electron from 'vite-plugin-electron/simple';
import electronCore from 'vite-plugin-electron';

const backendRuntimeExternals = ['@reflink/reflink'];
const DEFAULT_MAX_WORKERS = 4;
const HARD_MAX_WORKERS = 8;

function resolveMaxWorkers(): number {
  const parsed = Number(process.env.TASKSAIL_VITEST_MAX_WORKERS);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_WORKERS;

  const floored = Math.floor(parsed);
  if (floored <= 0) return DEFAULT_MAX_WORKERS;

  return Math.min(floored, HARD_MAX_WORKERS);
}

const MAX_WORKERS = resolveMaxWorkers();
const childGuardPath = fileURLToPath(
  new URL('./vitest.childProcessGuard.ts', import.meta.url),
);

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: backendRuntimeExternals,
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
    // The pipeline child is reached only via runtime child_process.fork from
    // spawnPipeline.ts — it is never imported by main.ts, so Vite's static
    // graph never sees it. Emit it as its own dist-electron entry so
    // resolveChildEntryPath can find pipelineChildEntry.js at fork time.
    electronCore({
      entry: '../../backend/platform/agent-runner/pipelineChildEntry.ts',
      vite: {
        build: {
          rollupOptions: {
            external: backendRuntimeExternals,
          },
        },
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts', childGuardPath],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: MAX_WORKERS,
        minForks: 1,
        execArgv: ['--max-old-space-size=1536'],
      },
    },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx', 'electron/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/test/**',
        'dist/**',
        'dist-electron/**',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 75,
        lines: 80,
      },
    },
  },
});
