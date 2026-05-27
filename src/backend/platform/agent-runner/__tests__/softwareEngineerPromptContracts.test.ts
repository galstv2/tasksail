import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('Dalton prompt contracts', () => {
  it('makes multi-slice ownership explicit for weak models', () => {
    const instructions = readFileSync(
      path.join(repoRoot, '.github', 'copilot', 'instructions', 'software-engineer.instructions.md'),
      'utf-8',
    );

    expect(instructions).toContain('## Multi-Slice Execution Contract');
    expect(instructions).toContain('you own every listed slice');
    expect(instructions).toContain('Slices are not future turns, optional follow-ups, separate tasks');
    expect(instructions).toContain('Complete every listed slice before final validation and exit');
    expect(instructions).toContain('record the exact slice ID, unavailable prerequisite, paths or commands checked');
    expect(instructions).toContain('Do not exit after completing only one slice');
    expect(instructions).toContain('If any slice remains incomplete, do not claim the overall task is complete');
  });
});
