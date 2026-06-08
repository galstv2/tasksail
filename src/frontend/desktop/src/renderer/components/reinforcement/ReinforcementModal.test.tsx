// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ReinforcementModal from './ReinforcementModal';

afterEach(() => {
  cleanup();
});

describe('ReinforcementModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ReinforcementModal isOpen={false} onClose={vi.fn()} hasActiveContextPack={true} activeContextPackDir="/packs/test" />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<ReinforcementModal isOpen={true} onClose={onClose} hasActiveContextPack={true} activeContextPackDir="/packs/test" />);

    fireEvent.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ReinforcementModal isOpen={true} onClose={onClose} hasActiveContextPack={true} activeContextPackDir="/packs/test" />);

    fireEvent.click(screen.getByRole('presentation'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<ReinforcementModal isOpen={true} onClose={onClose} hasActiveContextPack={true} activeContextPackDir="/packs/test" />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when clicking inside the modal', () => {
    const onClose = vi.fn();
    render(<ReinforcementModal isOpen={true} onClose={onClose} hasActiveContextPack={true} activeContextPackDir="/packs/test" />);

    fireEvent.click(screen.getByRole('dialog'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
