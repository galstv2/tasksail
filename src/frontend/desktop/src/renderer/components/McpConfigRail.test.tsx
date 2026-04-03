import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import McpConfigRail from './McpConfigRail';

afterEach(cleanup);

describe('McpConfigRail', () => {
  it('renders icon button', () => {
    render(<McpConfigRail enabledCount={0} onClick={vi.fn()} />);
    expect(screen.getByLabelText('Open MCP configuration')).toBeTruthy();
  });

  it('shows pmdge count when enabled servers exist', () => {
    render(<McpConfigRail enabledCount={3} onClick={vi.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('hides pmdge when count is zero', () => {
    const { container } = render(<McpConfigRail enabledCount={0} onClick={vi.fn()} />);
    expect(container.querySelector('.mcp-rail__pmdge')).toBeNull();
  });

  it('calls onClick when button is clicked', () => {
    const onClick = vi.fn();
    render(<McpConfigRail enabledCount={0} onClick={onClick} />);
    fireEvent.click(screen.getByLabelText('Open MCP configuration'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
