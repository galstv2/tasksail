import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import AgentInstructionsEditor from './AgentInstructionsEditor';
import type { AgentInstructionsEditorProps } from '../../hooks/agent-config/useAgentInstructionsModal';

afterEach(cleanup);

function defaultProps(overrides: Partial<AgentInstructionsEditorProps> = {}): AgentInstructionsEditorProps {
  return {
    isOpen: true,
    file: {
      fileName: 'provider-planner.md',
      relativePath: '.provider/agents/provider-planner.md',
      savedContent: 'saved',
      editorContent: 'edited',
      loaded: true,
    },
    activeDirectory: 'profiles',
    saving: false,
    confirmCloseVisible: false,
    confirmSaveVisible: false,
    onEditorChange: vi.fn(),
    onRequestSave: vi.fn(),
    onConfirmSave: vi.fn().mockResolvedValue(undefined),
    onCancelSave: vi.fn(),
    onDiscard: vi.fn(),
    onClose: vi.fn(),
    onConfirmClose: vi.fn(),
    onCancelClose: vi.fn(),
    ...overrides,
  };
}

describe('AgentInstructionsEditor', () => {
  it('uses the stable instructions editor shell sizing', () => {
    render(<AgentInstructionsEditor {...defaultProps()} />);

    const dialog = screen.getByRole('dialog', { name: 'Viewing provider-planner.md' });
    expect(dialog).toHaveClass('instructions-editor-shell');
    expect(dialog).toHaveStyle({
      '--modal-shell-max-w': '820px',
      '--modal-shell-max-h': 'min(78vh, 640px)',
    });
  });
});
