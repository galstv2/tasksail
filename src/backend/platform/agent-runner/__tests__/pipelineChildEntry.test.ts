import { describe, expect, it } from 'vitest';
import { formatPipelineChildEntryError } from '../pipelineChildEntry.js';

describe('formatPipelineChildEntryError', () => {
  it('renders confinement violations as controlled guardrail blocking', () => {
    const output = formatPipelineChildEntryError(
      new Error('Dalton edited files outside the enforced writable roots: /repo/leak.ts'),
    );

    expect(output).toBe(
      [
        '[pipelineChildEntry] Confinement blocked task safely: Dalton changed files outside the selected writable scope.',
        '[pipelineChildEntry] Review the Dalton guardrail receipt for the affected paths.',
      ].join('\n') + '\n',
    );
    expect(output).not.toContain('Fatal error');
  });

  it('keeps unexpected errors on the fatal path', () => {
    expect(formatPipelineChildEntryError(new Error('database exploded'))).toBe(
      '[pipelineChildEntry] Fatal error: database exploded\n',
    );
  });

  it('does not classify generic Dalton failures as confinement blocks', () => {
    const output = formatPipelineChildEntryError(
      new Error('Dalton failed while editing selected files'),
    );

    expect(output).toContain('Fatal error');
    expect(output).not.toContain('Confinement blocked task safely');
  });
});
