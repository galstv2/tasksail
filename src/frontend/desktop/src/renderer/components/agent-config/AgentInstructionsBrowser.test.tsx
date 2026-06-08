import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import AgentInstructionsBrowser from './AgentInstructionsBrowser';
import type { AgentInstructionsBrowserProps } from '../../hooks/agent-config/useAgentInstructionsModal';
import { createProviderFrontendDescriptor } from '../../../test/factories/fixtureFactory';

afterEach(cleanup);

function defaultProps(overrides: Partial<AgentInstructionsBrowserProps> = {}): AgentInstructionsBrowserProps {
  return {
    isOpen: true,
    isLoading: false,
    files: {
      profiles: [
        { fileName: 'provider-planner.md', relativePath: '.provider/agents/provider-planner.md' },
      ],
      instructions: [],
      prompts: [
        { fileName: 'planner.prompt.md', relativePath: '.provider/prompts/planner.prompt.md' },
        { fileName: 'provider-qa.prompt.md', relativePath: '.provider/prompts/provider-qa.prompt.md' },
      ],
      templates: [],
    },
    draftsByPath: {},
    descriptor: createProviderFrontendDescriptor(),
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
