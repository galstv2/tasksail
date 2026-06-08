import { renderHook } from '@testing-library/react';
import {
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REPO_ROOT } from '../../../../electron/paths';

const REAL_LOG_DIR = path.join(REPO_ROOT, '.platform-state', 'logs');

let mockAddToast: ReturnType<typeof vi.fn>;
let mockEmit: ReturnType<typeof vi.fn>;
let mockGetBootstrapInfo: ReturnType<typeof vi.fn>;
let realLogSnapshot: Map<string, { mtimeMs: number; size: number }>;

vi.mock('../../contexts/ToastContext', () => ({
  useToastContext: () => ({ addToast: mockAddToast }),
}));

beforeEach(() => {
  realLogSnapshot = snapshotRealLogs();
  mockAddToast = vi.fn();
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
  vi.restoreAllMocks();
  expect(snapshotRealLogs()).toEqual(realLogSnapshot);
});

describe('useErrorToast', () => {
  it('logs and displays error toasts', async () => {
    const { useErrorToast } = await importHook();
    const { result } = renderHook(() => useErrorToast());

    result.current.reportError(new Error('boom'));

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', msg: 'app.error.reported' }),
    );
    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'boom',
      severity: 'error',
    });
  });

  it('uses a custom toast message when provided', async () => {
    const { useErrorToast } = await importHook();
    const { result } = renderHook(() => useErrorToast());

    result.current.reportError(new Error('boom'), 'Custom message');

    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'Custom message',
      severity: 'error',
    });
  });

  it('uses the fallback message for non-error values', async () => {
    const { useErrorToast } = await importHook();
    const { result } = renderHook(() => useErrorToast());

    result.current.reportError('string error');

    expect(mockAddToast).toHaveBeenCalledWith({
      message: 'An unexpected error occurred.',
      severity: 'error',
    });
  });

  it('logs before showing the toast', async () => {
    const callOrder: string[] = [];
    mockEmit.mockImplementation(() => {
      callOrder.push('log');
      return Promise.resolve({ ok: true });
    });
    mockAddToast.mockImplementation(() => {
      callOrder.push('toast');
    });
    const { useErrorToast } = await importHook();
    const { result } = renderHook(() => useErrorToast());

    result.current.reportError(new Error('boom'));

    expect(callOrder).toEqual(['log', 'toast']);
  });
});

async function importHook(): Promise<typeof import('./useErrorToast')> {
  vi.resetModules();
  return import('./useErrorToast');
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
