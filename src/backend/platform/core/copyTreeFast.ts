import fs from 'node:fs';
import path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

export type CopyTreeSelectedStrategy =
  | 'apfs-clonefile'
  | 'reflink'
  | 'win-refs'
  | 'copy';

export type CopyTreeEffectiveStrategy =
  | 'apfs-clonefile'
  | 'reflink'
  | 'win-refs'
  | 'native-copy'
  | 'node-copy';

export interface CopyTreeFastResult {
  selectedStrategy: CopyTreeSelectedStrategy;
  effectiveStrategy: CopyTreeEffectiveStrategy;
  reflinkAttempted: boolean;
  reflinkUsed: boolean;
  fallbackReason: string | null;
  durationMs: number;
}

export interface CopyTreeFastDeps {
  platform: NodeJS.Platform;
  execFile: (
    file: string,
    args: readonly string[],
    options?: { windowsHide?: boolean },
  ) => Promise<{ stdout?: string; stderr?: string }>;
  nodeCopy: (src: string, dst: string) => Promise<void>;
  reflinkTreeWindows: (src: string, dst: string) => Promise<void>;
  now: () => number;
}

const execFileAsync = promisify(execFileCb);

const defaultDeps: CopyTreeFastDeps = {
  platform: process.platform,
  execFile: async (file, args, options) => {
    await execFileAsync(file, [...args], options);
    return {};
  },
  nodeCopy: (src, dst) => fs.promises.cp(src, dst, { recursive: true, force: true }),
  reflinkTreeWindows,
  now: () => Date.now(),
};

interface CopyAttempt {
  effectiveStrategy: CopyTreeEffectiveStrategy;
  run: () => Promise<void>;
}

interface RobocopyError extends Error {
  code?: number | string;
}

export async function copyTreeFast(
  src: string,
  dst: string,
  selectedStrategy: CopyTreeSelectedStrategy,
  deps?: Partial<CopyTreeFastDeps>,
): Promise<CopyTreeFastResult> {
  const resolvedDeps: CopyTreeFastDeps = { ...defaultDeps, ...deps };
  const startedAt = resolvedDeps.now();
  const reflinkAttempted = selectedStrategy === 'apfs-clonefile' ||
    selectedStrategy === 'reflink' ||
    selectedStrategy === 'win-refs';

  try {
    const result = await runAttempts(
      attemptsFor(src, dst, selectedStrategy, resolvedDeps),
      selectedStrategy,
    );
    return {
      selectedStrategy,
      effectiveStrategy: result.effectiveStrategy,
      reflinkAttempted,
      reflinkUsed: result.effectiveStrategy === 'apfs-clonefile' ||
        result.effectiveStrategy === 'reflink' ||
        result.effectiveStrategy === 'win-refs',
      fallbackReason: result.fallbackReason,
      durationMs: Math.max(0, resolvedDeps.now() - startedAt),
    };
  } catch (err) {
    attachDurationForTests(err, Math.max(0, resolvedDeps.now() - startedAt));
    throw err;
  }
}

function attemptsFor(
  src: string,
  dst: string,
  selectedStrategy: CopyTreeSelectedStrategy,
  deps: CopyTreeFastDeps,
): CopyAttempt[] {
  if (deps.platform === 'win32') {
    if (selectedStrategy === 'win-refs') {
      return [
        {
          effectiveStrategy: 'win-refs',
          run: () => deps.reflinkTreeWindows(src, dst),
        },
        robocopyAttempt(src, dst, deps),
        nodeCopyAttempt(src, dst, deps),
      ];
    }
    return [
      robocopyAttempt(src, dst, deps),
      nodeCopyAttempt(src, dst, deps),
    ];
  }

  if (deps.platform === 'darwin') {
    if (selectedStrategy === 'apfs-clonefile') {
      return [
        {
          effectiveStrategy: 'apfs-clonefile',
          run: () => deps.execFile('cp', ['-cR', src, dst]).then(() => undefined),
        },
        {
          effectiveStrategy: 'native-copy',
          run: () => deps.execFile('cp', ['-pR', src, dst]).then(() => undefined),
        },
        nodeCopyAttempt(src, dst, deps),
      ];
    }
    return [
      {
        effectiveStrategy: 'native-copy',
        run: () => deps.execFile('cp', ['-pR', src, dst]).then(() => undefined),
      },
      nodeCopyAttempt(src, dst, deps),
    ];
  }

  if (selectedStrategy === 'reflink') {
    return [
      {
        effectiveStrategy: 'reflink',
        run: () => deps.execFile('cp', ['-a', '--reflink=always', src, dst]).then(() => undefined),
      },
      {
        effectiveStrategy: 'native-copy',
        run: () => deps.execFile('cp', ['-a', src, dst]).then(() => undefined),
      },
      nodeCopyAttempt(src, dst, deps),
    ];
  }

  return [
    {
      effectiveStrategy: 'native-copy',
      run: () => deps.execFile('cp', ['-a', src, dst]).then(() => undefined),
    },
    nodeCopyAttempt(src, dst, deps),
  ];
}

function robocopyAttempt(src: string, dst: string, deps: CopyTreeFastDeps): CopyAttempt {
  return {
    effectiveStrategy: 'native-copy',
    run: async () => {
      try {
        await deps.execFile('robocopy', [
          src,
          dst,
          '/E',
          '/COPY:DAT',
          '/DCOPY:DAT',
          '/R:2',
          '/W:1',
          '/NFL',
          '/NDL',
          '/NJH',
          '/NJS',
          '/NP',
        ], { windowsHide: true });
      } catch (err) {
        const code = (err as RobocopyError).code;
        if (typeof code === 'number' && code >= 0 && code <= 7) {
          return;
        }
        throw err;
      }
    },
  };
}

function nodeCopyAttempt(src: string, dst: string, deps: CopyTreeFastDeps): CopyAttempt {
  return {
    effectiveStrategy: 'node-copy',
    run: () => deps.nodeCopy(src, dst),
  };
}

async function runAttempts(
  attempts: CopyAttempt[],
  selectedStrategy: CopyTreeSelectedStrategy,
): Promise<{ effectiveStrategy: CopyTreeEffectiveStrategy; fallbackReason: string | null }> {
  let fallbackReason: string | null = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]!;
    try {
      await attempt.run();
      return {
        effectiveStrategy: attempt.effectiveStrategy,
        fallbackReason,
      };
    } catch (err) {
      if (selectedStrategy === 'win-refs' && index === 0 && !isReflinkRecoverable(err)) {
        throw err;
      }
      fallbackReason ??= fallbackReasonFor(err);
      if (index === attempts.length - 1) {
        attachPriorFailureForTests(err, fallbackReason);
        throw err;
      }
    }
  }

  throw new Error('copyTreeFast has no copy attempts');
}

async function reflinkTreeWindows(src: string, dst: string): Promise<void> {
  const mod = await import('@reflink/reflink');
  const reflinkExports = (mod as { default?: unknown }).default ?? mod;
  const { reflinkFileSync } = reflinkExports as {
    reflinkFileSync: (s: string, d: string) => number;
  };
  await walkAndReflink(src, dst, reflinkFileSync);
}

async function walkAndReflink(
  src: string,
  dst: string,
  reflinkFileSync: (s: string, d: string) => number,
): Promise<void> {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await fs.promises.mkdir(dst, { recursive: true });
  await Promise.all(entries.map(async (entry) => {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await walkAndReflink(s, d, reflinkFileSync);
    } else if (entry.isFile()) {
      reflinkFileSync(s, d);
    } else if (entry.isSymbolicLink()) {
      const target = await fs.promises.readlink(s);
      await fs.promises.symlink(target, d);
    }
  }));
}

function isReflinkRecoverable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as NodeJS.ErrnoException).code;
  const message = (err as Error).message ?? '';
  return (
    code === 'MODULE_NOT_FOUND' ||
    code === 'ERR_MODULE_NOT_FOUND' ||
    code === 'EXDEV' ||
    code === 'ENOTSUP' ||
    code === 'EOPNOTSUPP' ||
    /ERROR_BLOCK_TOO_MANY_REFERENCES/i.test(message) ||
    /cloning is not supported/i.test(message)
  );
}

function fallbackReasonFor(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'unknown';
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== undefined && code !== null) {
    return String(code);
  }
  const message = (err as Error).message ?? '';
  if (/ERROR_BLOCK_TOO_MANY_REFERENCES/i.test(message)) {
    return 'ERROR_BLOCK_TOO_MANY_REFERENCES';
  }
  if (/cloning is not supported/i.test(message)) {
    return 'cloning-not-supported';
  }
  return 'copy-failed';
}

function attachPriorFailureForTests(err: unknown, fallbackReason: string): void {
  if (err && typeof err === 'object') {
    Object.defineProperty(err, 'copyTreeFastPriorFailure', {
      value: fallbackReason,
      configurable: true,
    });
  }
}

function attachDurationForTests(err: unknown, durationMs: number): void {
  if (err && typeof err === 'object') {
    Object.defineProperty(err, 'copyTreeFastDurationMs', {
      value: durationMs,
      configurable: true,
    });
  }
}
