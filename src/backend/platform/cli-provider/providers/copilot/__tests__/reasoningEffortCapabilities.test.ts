import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';


vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

const HELP = `
Usage: copilot [options]
  --effort, --reasoning-effort <effort>
      choices: none, low, medium,
        high, xhigh, max
`;

const QUOTED_HELP = `
Options:
  --effort, --reasoning-effort <level>  Set the reasoning effort level (choices:
                                        "none", "low", "medium", "high",
                                        "xhigh", "max")
`;

const DEEPLY_WRAPPED_HELP = `
Options:
  --effort, --reasoning-effort <level>  Set the reasoning effort level.
                                        Allowed values:
                                        "none",
                                        "low",
                                        "medium",
                                        "high",
                                        "xhigh",
                                        "max"
  --model <model>                       Set the AI model to use
`;

const BRACE_HELP = `
Options:
  --effort <level>  Set reasoning effort {none|low|medium|high|xhigh|max}
`;

const ONE_OF_HELP = `
Options:
  --reasoning-effort <level>  one of: none, low, medium, high, xhigh, max.
`;

let repoRoot: string;

function cachePath(): string {
  return path.join(repoRoot, '.platform-state', 'copilot-cli-capabilities.json');
}

function writeCache(overrides: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  fs.writeFileSync(cachePath(), JSON.stringify({
    schema_version: 1,
    provider_id: 'copilot',
    cli_version: 'GitHub Copilot CLI 1.0.54',
    captured_at: new Date().toISOString(),
    reasoning_effort_choices: ['low', 'medium', 'high'],
    ...overrides,
  }, null, 2));
}

function mockProbe(version = 'GitHub Copilot CLI 1.0.55', help = HELP, expectedCommand = 'copilot'): void {
  mockedExecFile.mockImplementation((cmd, args, ...rest: unknown[]) => {
    expect(cmd).toBe(expectedCommand);
    expect(args).toEqual((args as string[])[0] === '--version' ? ['--version'] : ['--help']);
    const cb = rest.find((value) => typeof value === 'function') as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    if (!cb) {
      throw new Error('missing callback');
    }
    cb(null, (args as string[])[0] === '--version' ? version : help, '');
    return {} as ReturnType<typeof execFile>;
  });
}

async function importSubject(): Promise<typeof import('../reasoningEffortCapabilities.js')> {
  return import('../reasoningEffortCapabilities.js');
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-effort-capabilities-'));
  mockedExecFile.mockReset();
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe('Copilot reasoning effort capability discovery', () => {
  it.each([
    [HELP, 'wrapped choices'] as const,
    [QUOTED_HELP, 'quoted choices from current Copilot help'] as const,
    [DEEPLY_WRAPPED_HELP, 'deeply wrapped option paragraph'] as const,
    [BRACE_HELP, 'brace format'] as const,
    [ONE_OF_HELP, 'one-of format'] as const,
  ])('extracts provider-advertised effort choices: %s', async (helpText, _label) => {
    const { parseCopilotReasoningEffortChoices } = await importSubject();

    expect(parseCopilotReasoningEffortChoices(helpText)).toEqual(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('returns a fresh cache without spawning Copilot', async () => {
    writeCache();
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(getCopilotReasoningEffortCapabilities(repoRoot, 'copilot')).resolves.toMatchObject({
      source: 'cache',
      stale: false,
      effortChoices: ['low', 'medium', 'high'],
    });
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it('forwards the resolved command to execFile so Windows probes copilot.cmd', async () => {
    mockProbe(undefined, undefined, 'copilot.cmd');
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(
      getCopilotReasoningEffortCapabilities(repoRoot, 'copilot.cmd'),
    ).resolves.toMatchObject({ providerId: 'copilot' });

    expect(mockedExecFile).toHaveBeenCalled();
    expect(mockedExecFile.mock.calls.every((call) => call[0] === 'copilot.cmd')).toBe(true);
  });

  it.each([
    ['missing cache', null],
    ['malformed cache', '{'],
    ['provider mismatch', { provider_id: 'other' }],
    ['schema mismatch', { schema_version: 2 }],
    ['stale cache', { captured_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }],
    ['CLI version refresh', { cli_version: 'GitHub Copilot CLI 1.0.1', captured_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }],
  ])('refreshes %s with version/help probes', async (_name, cache) => {
    if (typeof cache === 'string') {
      fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
      fs.writeFileSync(cachePath(), cache);
    } else if (cache) {
      writeCache(cache);
    }
    mockProbe();
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(getCopilotReasoningEffortCapabilities(repoRoot, 'copilot')).resolves.toMatchObject({
      source: 'probe',
      stale: false,
      cliVersion: 'GitHub Copilot CLI 1.0.55',
      effortChoices: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent probes for one repo root', async () => {
    mockProbe();
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await Promise.all([
      getCopilotReasoningEffortCapabilities(repoRoot, 'copilot'),
      getCopilotReasoningEffortCapabilities(repoRoot, 'copilot'),
      getCopilotReasoningEffortCapabilities(repoRoot, 'copilot'),
    ]);
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable capabilities without throwing when probing fails', async () => {
    mockedExecFile.mockImplementation((_cmd, _args, ...rest: unknown[]) => {
      const cb = rest.find((value) => typeof value === 'function') as
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      cb?.(new Error('missing copilot'), '', '');
      return {} as ReturnType<typeof execFile>;
    });
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(getCopilotReasoningEffortCapabilities(repoRoot, 'copilot')).resolves.toMatchObject({
      source: 'unavailable',
      stale: true,
      effortChoices: [],
      errorCode: 'probe-failed',
    });
  });

  it('classifies missing effort flag separately from unparseable choices', async () => {
    mockProbe('GitHub Copilot CLI 1.0.55', 'Usage: copilot [options]\\n  --model <model> Set model');
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(getCopilotReasoningEffortCapabilities(repoRoot, 'copilot')).resolves.toMatchObject({
      source: 'unavailable',
      stale: true,
      effortChoices: [],
      errorCode: 'effort-flag-missing',
    });
  });

  it('classifies unparseable effort choices when the flag exists', async () => {
    mockProbe('GitHub Copilot CLI 1.0.55', 'Usage: copilot [options]\\n  --effort <level> Set reasoning effort');
    const { getCopilotReasoningEffortCapabilities } = await importSubject();

    await expect(getCopilotReasoningEffortCapabilities(repoRoot, 'copilot')).resolves.toMatchObject({
      source: 'unavailable',
      stale: true,
      effortChoices: [],
      errorCode: 'choices-unparseable',
    });
  });
});
