import { cleanup, render, screen } from '@testing-library/react';
import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../../electron/paths';

const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');

let mockEmit: ReturnType<typeof vi.fn>;
let mockGetBootstrapInfo: ReturnType<typeof vi.fn>;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;

beforeEach(() => {
  realLogSnapshot = snapshotRealLogs();
  mockEmit = vi.fn().mockResolvedValue({ ok: true });
  mockGetBootstrapInfo = vi.fn().mockResolvedValue({
    appName: 'TaskSail',
    platform: 'test',
    logLevel: 'info',
    rendererForwardLevel: 'info',
    versions: { chrome: undefined, electron: undefined, node: 'test' },
  });
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      log: { emit: mockEmit },
      getBootstrapInfo: mockGetBootstrapInfo,
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

function ThrowingChild(): JSX.Element {
  throw new Error('Test error');
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', async () => {
    const { default: ErrorBoundary } = await importErrorBoundary();

    render(
      <ErrorBoundary>
        <p>Hello</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('renders default fallback and logs when child throws', async () => {
    const { default: ErrorBoundary } = await importErrorBoundary();

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        msg: 'react.error.boundary',
      }),
    );
  });

  it('renders custom fallback when provided', async () => {
    const { default: ErrorBoundary } = await importErrorBoundary();

    render(
      <ErrorBoundary fallback={<p>Custom error view</p>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error view')).toBeInTheDocument();
  });
});

async function importErrorBoundary(): Promise<typeof import('./ErrorBoundary')> {
  vi.resetModules();
  return import('./ErrorBoundary');
}

function snapshotRealLogs(): Map<string, { mtimeMs: number; size: number }> {
  const snapshot = new Map<string, { mtimeMs: number; size: number }>();
  if (!existsSync(REAL_LOG_DIR)) return snapshot;

  for (const filePath of walkFiles(REAL_LOG_DIR)) {
    const stat = statSync(filePath);
    snapshot.set(path.relative(REAL_LOG_DIR, filePath), {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    });
  }
  return snapshot;
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}
