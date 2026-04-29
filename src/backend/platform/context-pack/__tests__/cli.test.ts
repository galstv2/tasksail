import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../cli.js';

describe('context-pack cli', () => {
  let stdout = '';
  let stderr = '';
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    stdout = '';
    stderr = '';
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('writes usage to stderr and exits non-zero when no command is provided', async () => {
    await main([]);

    expect(stderr).toContain('Usage: context-pack');
    expect(stdout).toBe('');
    expect(process.exitCode).toBe(1);
  });

  it('writes usage to stdout and does not fail for help', async () => {
    await main(['--help']);

    expect(stdout).toContain('Usage: context-pack');
    expect(stderr).toBe('');
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('rejects qmd-seed as an unsupported context-pack subcommand', async () => {
    await main(['qmd-seed']);

    expect(stderr).toContain('Usage: context-pack');
    expect(stdout).toBe('');
    expect(process.exitCode).toBe(1);
  });
});
