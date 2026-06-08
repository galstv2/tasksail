import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import McpConfigRail from './McpConfigRail';

afterEach(cleanup);

describe('McpConfigRail', () => {
  it('shows pmdge count when enabled servers exist', () => {
    render(<McpConfigRail enabledCount={3} onClick={vi.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('hides pmdge when count is zero', () => {
    const { container } = render(<McpConfigRail enabledCount={0} onClick={vi.fn()} />);
    expect(container.querySelector('.mcp-rail__pmdge')).toBeNull();
  });

});
