import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

describe('taskBoard.readTaskContent artifactRelativePath', () => {
  it('accepts a request with no artifactRelativePath', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed' },
    })).toEqual([]);
  });

  it('accepts a non-empty artifactRelativePath string', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed', artifactRelativePath: 'handoffs/final-summary.md' },
    })).toEqual([]);
  });

  it('rejects an empty artifactRelativePath string', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed', artifactRelativePath: '' },
    })).toContain('payload.artifactRelativePath must be a non-empty string when provided.');
  });

  it('rejects a non-string artifactRelativePath value', () => {
    expect(validateDesktopActionRequest({
      action: 'taskBoard.readTaskContent',
      payload: { fileName: 'task.md', column: 'completed', artifactRelativePath: 123 },
    })).toContain('payload.artifactRelativePath must be a non-empty string when provided.');
  });
});
