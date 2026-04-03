import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToastProvider, useToastContext } from './ToastContext';

afterEach(() => {
  cleanup();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe('ToastContext', () => {
  it('provides toasts, addToast, and dismissToast inside the provider', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });
    expect(result.current.toasts).toEqual([]);
    expect(typeof result.current.addToast).toBe('function');
    expect(typeof result.current.dismissToast).toBe('function');
  });

  it('throws when used outside ToastProvider', () => {
    expect(() => {
      renderHook(() => useToastContext());
    }).toThrow('useToastContext must be used within a ToastProvider');
  });

  it('adds a toast to the list', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    act(() => {
      result.current.addToast({ message: 'Hello', severity: 'info', duration: 60000 });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Hello');
    expect(result.current.toasts[0].severity).toBe('info');
  });

  it('dismisses the correct toast by id', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    act(() => {
      result.current.addToast({ message: 'First', severity: 'info', duration: 60000 });
      result.current.addToast({ message: 'Second', severity: 'warning', duration: 60000 });
    });

    const firstId = result.current.toasts[0].id;

    act(() => {
      result.current.dismissToast(firstId);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe('Second');
  });

  it('supports multiple concurrent toasts', () => {
    const { result } = renderHook(() => useToastContext(), { wrapper });

    act(() => {
      result.current.addToast({ message: 'A', severity: 'info', duration: 60000 });
      result.current.addToast({ message: 'B', severity: 'error', duration: 60000 });
      result.current.addToast({ message: 'C', severity: 'success', duration: 60000 });
    });

    expect(result.current.toasts).toHaveLength(3);
  });
});
