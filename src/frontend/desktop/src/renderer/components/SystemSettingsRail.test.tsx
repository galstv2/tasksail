// @vitest-environment jsdom

import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SystemSettingsRail from './SystemSettingsRail';

expect.extend(matchers);
afterEach(() => cleanup());

describe('SystemSettingsRail', () => {
  it('renders an accessible gear button using the shared rail styling and calls onClick', () => {
    const onClick = vi.fn();
    render(<SystemSettingsRail onClick={onClick} />);

    const button = screen.getByRole('button', { name: 'Open system settings' });
    expect(button).toHaveClass('config-rail__btn');
    expect(button).toHaveAttribute('title', 'System Settings');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
