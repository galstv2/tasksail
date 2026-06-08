import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopInvokeResult } from '../../../shared/desktopContract';

import { useIpcCall } from './useIpcCall';

function successResult(response: Record<string, unknown>): DesktopInvokeResult {
  return { ok: true, response } as unknown as DesktopInvokeResult;
}

function errorResult(error: string, details?: string[], errorCode?: string): DesktopInvokeResult {
  return { ok: false, error, details, errorCode } as DesktopInvokeResult;
}

describe('useIpcCall', () => {
  it('returns ok:true and clears error on success', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.resolve(successResult({ value: 1 })),
        { timeoutMs: 0 },
      );
    });

    expect(callResult).toEqual({ ok: true, response: { value: 1 } });
    expect(onError).toHaveBeenCalledWith('');
  });

  it('returns ok:false and calls onError when result.ok is false', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.resolve(errorResult('bad request', ['detail1'])),
        { timeoutMs: 0 },
      );
    });

    expect(callResult).toEqual({ ok: false, error: 'bad request', details: ['detail1'] });
    expect(onError).toHaveBeenCalledWith('bad request detail1');
  });

  it('returns raw structured error and details while setting formatted error text', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.resolve(errorResult('reseed in progress', ['pid=1234'], 'reseed_in_progress')),
        { timeoutMs: 0 },
      );
    });

    expect(callResult).toEqual({
      ok: false,
      error: 'reseed in progress',
      details: ['pid=1234'],
    });
    expect(onError).toHaveBeenCalledWith('reseed in progress pid=1234');
  });

  it('normalizes a thrown Error', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.reject(new Error('network down')),
        { timeoutMs: 0 },
      );
    });

    expect(callResult).toEqual({ ok: false, error: 'network down' });
    expect(onError).toHaveBeenCalledWith('network down');
  });

  it('normalizes a thrown non-Error with fallback message', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.reject('raw string'),
        { timeoutMs: 0, fallbackMessage: 'custom fallback' },
      );
    });

    expect(callResult).toEqual({ ok: false, error: 'custom fallback' });
    expect(onError).toHaveBeenCalledWith('custom fallback');
  });

  it('rejects via timeout when the action hangs', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    const promise = act(async () => {
      callResult = await result.current.call(
        () => new Promise<DesktopInvokeResult>(() => {}),
        { timeoutMs: 100, label: 'slow' },
      );
    });

    vi.advanceTimersByTime(100);
    await promise;

    expect(callResult.ok).toBe(false);
    expect(onError).toHaveBeenCalled();
    const errorArg = onError.mock.calls[0][0] as string;
    expect(errorArg).toContain('slow');
    vi.useRealTimers();
  });

  it('returns ok:false when validate rejects the response', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.resolve(successResult({ type: 'wrong' })),
        {
          timeoutMs: 0,
          label: 'typed call',
          validate: (_r: unknown): _r is { type: 'right' } => false,
        },
      );
    });

    expect(callResult).toEqual({ ok: false, error: 'typed call returned an unexpected response.' });
    expect(onError).toHaveBeenCalledWith('typed call returned an unexpected response.');
  });

  it('returns ok:true when validate accepts the response', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useIpcCall(onError));

    let callResult!: Awaited<ReturnType<typeof result.current.call>>;
    await act(async () => {
      callResult = await result.current.call(
        () => Promise.resolve(successResult({ type: 'right' })),
        {
          timeoutMs: 0,
          label: 'typed call',
          validate: (r: unknown): r is { type: 'right' } =>
            (r as Record<string, unknown>).type === 'right',
        },
      );
    });

    expect(callResult).toEqual({ ok: true, response: { type: 'right' } });
    expect(onError).toHaveBeenCalledWith('');
  });
});
