import { describe, expect, it, vi } from 'vitest';

import {
  formatIpcError,
  normalizeIpcThrownError,
  withIpcTimeout,
  IpcTimeoutError,
} from './ipcErrorHelpers';

describe('formatIpcError', () => {
  it('returns just the error when there are no details', () => {
    expect(formatIpcError({ error: 'boom' })).toBe('boom');
  });

  it('returns just the error when details is undefined', () => {
    expect(formatIpcError({ error: 'boom', details: undefined })).toBe('boom');
  });

  it('appends details joined by spaces', () => {
    expect(formatIpcError({ error: 'fail', details: ['a', 'b'] })).toBe('fail a b');
  });

  it('handles a single detail entry', () => {
    expect(formatIpcError({ error: 'fail', details: ['only'] })).toBe('fail only');
  });

  it('returns just the error when details is an empty array', () => {
    expect(formatIpcError({ error: 'boom', details: [] })).toBe('boom');
  });
});

describe('normalizeIpcThrownError', () => {
  it('returns the message of an Error instance', () => {
    expect(normalizeIpcThrownError(new Error('oops'))).toBe('oops');
  });

  it('returns the default fallback for a non-Error value', () => {
    expect(normalizeIpcThrownError('stringy')).toBe('IPC call failed unexpectedly.');
  });

  it('uses a custom fallback for a non-Error value', () => {
    expect(normalizeIpcThrownError(42, 'custom fallback')).toBe('custom fallback');
  });

  it('returns Error.message even when a custom fallback is provided', () => {
    expect(normalizeIpcThrownError(new Error('real'), 'custom fallback')).toBe('real');
  });
});

describe('withIpcTimeout', () => {
  it('resolves with the promise value when it settles before timeout', async () => {
    const result = await withIpcTimeout(Promise.resolve('ok'), 5_000, 'test');
    expect(result).toBe('ok');
  });

  it('rejects with IpcTimeoutError when the promise does not settle in time', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = withIpcTimeout(never, 100, 'slow-call');

    vi.advanceTimersByTime(100);
    await expect(raced).rejects.toThrow(IpcTimeoutError);
    await expect(raced).rejects.toThrow('slow-call');
    vi.useRealTimers();
  });

  it('propagates rejection from the original promise', async () => {
    const err = new Error('inner fail');
    await expect(withIpcTimeout(Promise.reject(err), 5_000, 'test')).rejects.toThrow('inner fail');
  });

  it('cleans up the timer after resolution', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await withIpcTimeout(Promise.resolve('ok'), 5_000, 'test');

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
    vi.useRealTimers();
  });

  it('skips timeout when timeoutMs is 0', async () => {
    const result = await withIpcTimeout(Promise.resolve('fast'), 0, 'test');
    expect(result).toBe('fast');
  });
});
