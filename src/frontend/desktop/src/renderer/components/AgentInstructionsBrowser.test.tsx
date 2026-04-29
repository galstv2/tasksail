import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import AgentInstructionsBrowser from './AgentInstructionsBrowser';
import type { AgentInstructionsBrowserProps } from '../hooks/useAgentInstructionsModal';

afterEach(cleanup);

function defaultProps(overrides: Partial<AgentInstructionsBrowserProps> = {}): AgentInstructionsBrowserProps {
  return {
    isOpen: true,
    isLoading: false,
    files: {
      profiles: [
        { fileName: 'planning-agent.md', relativePath: '.github/agents/planning-agent.md' },
      ],
      instructions: [],
      prompts: [
        { fileName: 'planner.prompt.md', relativePath: '.provider/prompts/planner.prompt.md' },
        { fileName: 'qa.prompt.md', relativePath: '.provider/prompts/qa.prompt.md' },
      ],
      templates: [],
    },
    draftsByPath: {},
    error: null,
    loadingPath: null,
    onClose: vi.fn(),
    onSelectFile: vi.fn(),
    ...overrides,
  };
}

describe('AgentInstructionsBrowser', () => {
  it('keeps a stable shell size while switching tabs', () => {
    render(<AgentInstructionsBrowser {...defaultProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'Platform Instructions' });
    expect(dialog).toHaveStyle({
      width: 'min(720px, 100%)',
      height: 'min(78vh, 640px)',
    });

    fireEvent.click(screen.getByRole('tab', { name: /Instructions 0/i }));
    expect(dialog).toHaveStyle({
      width: 'min(720px, 100%)',
      height: 'min(78vh, 640px)',
    });

    fireEvent.click(screen.getByRole('tab', { name: /Prompts 2/i }));
    expect(dialog).toHaveStyle({
      width: 'min(720px, 100%)',
      height: 'min(78vh, 640px)',
    });
  });
});
