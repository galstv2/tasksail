import { fileURLToPath } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import electron from 'vite-plugin-electron/simple';
import electronCore from 'vite-plugin-electron';
import type { RollupLog, LoggingFunction } from 'rollup';
import { TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE } from './electron/devRestartProtocol';

const backendRuntimeExternals = ['@reflink/reflink'];

// Backend modules under src/backend/platform deliberately use `await import()`
// to break runtime cycles (operations.ts ↔ resumeCloseout.ts and
// sequencer.ts ↔ remediation.ts). Rollup still warns that the lazy import
// won't move the module into its own chunk because static importers exist
// elsewhere — but chunk splitting in an Electron main-process bundle has no
// benefit. Suppress only this specific warning so real issues stay loud.
const suppressDynamicImportChunkWarning = (
  warning: RollupLog,
  defaultHandler: LoggingFunction,
): void => {
  if (warning.code === 'DYNAMIC_IMPORT_WILL_NOT_MOVE_MODULE') return;
  if (warning.message?.includes('dynamic import will not move module into another chunk')) return;
  defaultHandler(warning);
};
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
const DEV_GRACEFUL_RESTART_TIMEOUT_MS = 2_000;
const DEV_FORCE_TERM_TIMEOUT_MS = 2_000;
const DEV_FORCE_KILL_TIMEOUT_MS = 1_000;
const childGuardPath = fileURLToPath(
  new URL('./vitest.childProcessGuard.ts', import.meta.url),
);

type ProcessWithElectronApp = NodeJS.Process & {
  electronApp?: ChildProcess;
};

function getElectronAppProcess(): ChildProcess | undefined {
  return (process as ProcessWithElectronApp).electronApp;
}

function clearElectronAppProcess(): void {
  delete (process as ProcessWithElectronApp).electronApp;
}

function hasElectronAppExited(electronApp: ChildProcess): boolean {
  if (electronApp.exitCode !== null || electronApp.signalCode !== null) {
    return true;
  }
  return false;
}

function waitForElectronAppExit(
  electronApp: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (hasElectronAppExited(electronApp)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      electronApp.off('exit', onExit);
      resolve(result);
    };
    const onExit = (): void => finish(true);

    electronApp.once('exit', onExit);
    timeout = setTimeout(() => finish(false), timeoutMs);
  });
}

async function requestGracefulElectronQuit(electronApp: ChildProcess): Promise<boolean> {
  if (hasElectronAppExited(electronApp)) return true;
  if (typeof electronApp.send !== 'function' || !electronApp.connected) return false;

  try {
    electronApp.send(TASKSAIL_DEV_GRACEFUL_RESTART_MESSAGE);
  } catch {
    return false;
  }
  return waitForElectronAppExit(electronApp, DEV_GRACEFUL_RESTART_TIMEOUT_MS);
}

async function stopElectronAppForRestart(): Promise<boolean> {
  const electronApp = getElectronAppProcess();
  if (!electronApp) return true;
  if (hasElectronAppExited(electronApp)) {
    clearElectronAppProcess();
    return true;
  }

  if (await requestGracefulElectronQuit(electronApp)) {
    clearElectronAppProcess();
    return true;
  }

  electronApp.kill('SIGTERM');
  if (await waitForElectronAppExit(electronApp, DEV_FORCE_TERM_TIMEOUT_MS)) {
    clearElectronAppProcess();
    return true;
  }

  electronApp.kill('SIGKILL');
  if (await waitForElectronAppExit(electronApp, DEV_FORCE_KILL_TIMEOUT_MS)) {
    clearElectronAppProcess();
    return true;
  }

  console.error('Previous Electron process did not exit after graceful, SIGTERM, and SIGKILL restart attempts.');
  return false;
}

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        async onstart({ startup }) {
          await stopElectronAppForRestart();
          await startup();
        },
        vite: {
          build: {
            rollupOptions: {
              external: backendRuntimeExternals,
              onwarn: suppressDynamicImportChunkWarning,
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
      onstart() {
        // TODO(vite-plugin-electron@0.29.0): this entry is fork-only at runtime.
        // Starting it as Electron main exits immediately and tears down dev.
      },
      vite: {
        build: {
          rollupOptions: {
            external: backendRuntimeExternals,
            onwarn: suppressDynamicImportChunkWarning,
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
    setupFiles: ['src/test/setup.ts', childGuardPath, 'src/test/logIsolation.ts'],
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
