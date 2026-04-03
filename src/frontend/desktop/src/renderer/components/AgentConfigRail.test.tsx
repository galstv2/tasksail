import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AgentConfigRail from './AgentConfigRail';

describe('AgentConfigRail', () => {
  it('renders the trigger and calls onClick', () => {
    const onClick = vi.fn();

    render(<AgentConfigRail onClick={onClick} />);

    fireEvent.click(screen.getByLabelText('Open agent configuration'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
