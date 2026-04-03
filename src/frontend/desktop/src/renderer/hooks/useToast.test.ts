import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useToast } from './useToast';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useToast', () => {
  it('addToast creates a toast with auto-generated ID', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast({ message: 'Hello', severity: 'info' });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Hello');
    expect(result.current.toasts[0].severity).toBe('info');
    expect(result.current.toasts[0].id).toMatch(/^toast-/);
  });

  it('toasts auto-dismiss after configured duration', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast({ message: 'Short', severity: 'success', duration: 1000 });
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('dismissToast removes a specific toast', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast({ message: 'First', severity: 'info' });
      result.current.addToast({ message: 'Second', severity: 'warning' });
    });

    expect(result.current.toasts).toHaveLength(2);

    act(() => {
      result.current.dismissToast(result.current.toasts[0].id);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Second');
  });

  it('multiple toasts can exist simultaneously', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast({ message: 'A', severity: 'info' });
      result.current.addToast({ message: 'B', severity: 'success' });
      result.current.addToast({ message: 'C', severity: 'error' });
    });

    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts.map((t) => t.message)).toEqual(['A', 'B', 'C']);
  });
});
