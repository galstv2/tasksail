import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Toast } from '../../hooks/shared/useToast';
import ToastContainer from './ToastContainer';

afterEach(() => {
  cleanup();
});

describe('ToastContainer', () => {
  it('renders nothing when toast list is empty', () => {
    const { container } = render(<ToastContainer toasts={[]} onDismiss={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders one toast with correct content', () => {
    const toasts: Toast[] = [{ id: 't1', message: 'Saved!', severity: 'success' }];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    const toasts: Toast[] = [
      { id: 't1', message: 'First', severity: 'info' },
      { id: 't2', message: 'Second', severity: 'warning' },
    ];
    render(<ToastContainer toasts={toasts} onDismiss={vi.fn()} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('dismiss button calls onDismiss with correct toast ID', () => {
    const onDismiss = vi.fn();
    const toasts: Toast[] = [{ id: 't1', message: 'Test', severity: 'error' }];
    render(<ToastContainer toasts={toasts} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });
});
