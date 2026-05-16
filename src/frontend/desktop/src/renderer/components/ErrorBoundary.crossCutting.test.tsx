import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let emit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  emit = vi.fn(() => Promise.resolve({ ok: true }));
  Object.defineProperty(window, 'desktopShell', {
    configurable: true,
    writable: true,
    value: {
      log: { emit },
      getBootstrapInfo: vi.fn(() => Promise.resolve({
        appName: 'TaskSail',
        platform: 'test',
        logLevel: 'info',
        rendererForwardLevel: 'info',
        versions: { chrome: undefined, electron: undefined, node: 'test' },
      })),
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary cross-cutting logging', () => {
  it('renders fallback UI and emits structured error payloads', async () => {
    const { default: ErrorBoundary } = await importFreshErrorBoundary();

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      msg: 'react.error.boundary',
      err: expect.objectContaining({ name: 'TypeError' }),
    }));
  });

  it('does not contain direct console calls', () => {
    const source = readFileSync(
      path.join(__dirname, 'ErrorBoundary.tsx'),
      'utf-8',
    );

    expect(source).not.toMatch(/console\./);
  });
});

function ThrowingChild(): JSX.Element {
  throw new TypeError('render failed');
}

async function importFreshErrorBoundary(): Promise<typeof import('./ErrorBoundary')> {
  vi.resetModules();
  return import('./ErrorBoundary');
}
