import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkLoggingDiscipline } from '../loggingDiscipline.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../../../..');
const PROTOCOL_ALLOWLIST_PATH = path.join(
  REPO_ROOT,
  'src/backend/platform/validation/protocolOutputAllowlist.json',
);
const TS_PROTOCOL_OUTPUT_HELPER = 'src/backend/platform/core/protocolOutput.ts';
const PY_PROTOCOL_OUTPUT_HELPER = 'src/backend/scripts/python/lib/protocol_output.py';
const TS_PROTOCOL_HELPER_CALL_RE = /\bwriteProtocol(?:Stdout|Stderr|Json)\s*\(/;
const PY_PROTOCOL_HELPER_CALL_RE = /\bwrite_protocol_(?:stdout|stderr|json)\s*\(/;

async function makeRepo(files: Record<string, string>): Promise<{ repoRoot: string }> {
  const repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logging-discipline-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(repoRoot, relPath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, content);
  }
  return { repoRoot };
}

async function check(files: Record<string, string>) {
  const { repoRoot } = await makeRepo(files);
  try {
    return await checkLoggingDiscipline({ repoRoot });
  } finally {
    await fs.promises.rm(repoRoot, { recursive: true, force: true });
  }
}

describe('checkLoggingDiscipline', () => {
  it('uses the source-controlled protocol allowlist by default', async () => {
    const repoRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'logging-discipline-default-'));
    try {
      const cliPath = path.join(repoRoot, 'src/backend/platform/queue/cli.ts');
      await fs.promises.mkdir(path.dirname(cliPath), { recursive: true });
      await fs.promises.writeFile(cliPath, 'writeProtocolStdout("ok\\n");\n');

      const result = await checkLoggingDiscipline({ repoRoot });

      expect(result.valid).toBe(true);
    } finally {
      await fs.promises.rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('keeps the protocol allowlist JSON aligned with live helper callers', async () => {
    const payload = JSON.parse(await fs.promises.readFile(PROTOCOL_ALLOWLIST_PATH, 'utf-8')) as {
      schema_version?: unknown;
      files?: unknown;
    };

    expect(payload.schema_version).toBe(1);
    expect(Array.isArray(payload.files)).toBe(true);

    const files = payload.files as string[];
    expect(files).toEqual([...new Set(files)]);
    expect(files).toEqual([...files].sort());
    expect(files).toEqual(await findLiveProtocolHelperCallers());
  });

  it('fails on TS console.log in production backend code', async () => {
    const result = await check({
      'src/backend/platform/queue/operations.ts': 'console.log("bad");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('operations.ts');
    expect(result.errors.join('\n')).toContain('console.*');
  });

  it.each([
    ['queue', 'src/backend/platform/queue/operations.fixture-only.ts'],
    ['agent-runner', 'src/backend/platform/agent-runner/agentSession.fixture-only.ts'],
  ])('fails raw stdout writes in %s production code', async (_label, filePath) => {
    const result = await check({ [filePath]: 'process.stdout.write("bad\\n");\n' });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        path: filePath,
        line: 1,
        message: expect.stringContaining('process.stdout.write'),
      }),
    ]);
  });

  it.each([
    ['console.log in queue', 'src/backend/platform/queue/operations.fixture-only.ts', 'console.log("bad");\n'],
    ['console.warn in agent-runner', 'src/backend/platform/agent-runner/agentSession.fixture-only.ts', 'console.warn("bad");\n'],
  ])('fails %s production code', async (_label, filePath, content) => {
    const result = await check({ [filePath]: content });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        path: filePath,
        line: 1,
        message: expect.stringContaining('console.*'),
      }),
    ]);
  });

  it('fails when logger.ts references protocolOutput', async () => {
    const result = await check({
      'src/backend/platform/core/logger.ts': 'import "./protocolOutput.js";\n',
    });

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([
      expect.objectContaining({
        path: 'src/backend/platform/core/logger.ts',
        line: 1,
        message: 'logger.ts must not import or reference protocolOutput',
      }),
    ]);
  });

  it('passes a TS helper call in an allow-listed production file', async () => {
    const result = await check({
      'src/backend/platform/queue/cli.ts': 'writeProtocolStdout("ok\\n");\n',
    });

    expect(result.valid).toBe(true);
  });

  it('fails a TS raw stdout write outside the protocol helper', async () => {
    const result = await check({
      'src/backend/platform/queue/cli.ts': 'process.stdout.write("bad\\n");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('process.stdout.write');
  });

  it('passes marked TS raw writes inside the protocol helper', async () => {
    const result = await check({
      'src/backend/platform/core/protocolOutput.ts': [
        'export function writeProtocolStdout(text: string): void {',
        '  // tasksail: protocol-output',
        '  process.stdout.write(text);',
        '}',
      ].join('\n'),
    });

    expect(result.valid).toBe(true);
  });

  it('passes an unmarked TS stderr write in the logger file', async () => {
    const result = await check({
      'src/backend/platform/core/logger.ts': 'process.stderr.write("warn\\n");\n',
    });

    expect(result.valid).toBe(true);
  });

  it('fails a TS marker outside the protocol helper', async () => {
    const result = await check({
      'src/backend/platform/queue/cli.ts': [
        '// tasksail: protocol-output',
        'process.stdout.write("bad\\n");',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('protocol marker is allowed only');
  });

  it('fails an orphan TS marker', async () => {
    const result = await check({
      'src/backend/platform/core/protocolOutput.ts': [
        '// tasksail: protocol-output',
        '',
        'process.stdout.write("bad\\n");',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('immediately followed');
  });

  it('fails when one TS marker precedes two adjacent writes', async () => {
    const result = await check({
      'src/backend/platform/core/protocolOutput.ts': [
        '// tasksail: protocol-output',
        'process.stdout.write("one"); process.stderr.write("two");',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('one protocol marker may authorize only one');
  });

  it('fails a TS protocol helper call in a non-allow-listed production file', async () => {
    const result = await check({
      'src/backend/platform/queue/operations.ts': 'writeProtocolStdout("bad\\n");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('writeProtocolStdout() is allowed only');
  });

  it('passes a Python helper call in an allow-listed file', async () => {
    const result = await check({
      'src/backend/scripts/python/lib/cli.py': 'write_protocol_stdout("ok\\n")\n',
    });

    expect(result.valid).toBe(true);
  });

  it('fails a Python print anywhere under src/backend', async () => {
    const result = await check({
      'src/backend/scripts/python/cli.py': 'print("bad")\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('print() is forbidden');
  });

  it('fails a Python raw sys.stdout.write outside protocol_output.py', async () => {
    const result = await check({
      'src/backend/scripts/python/cli.py': [
        'import sys',
        'sys.stdout.write("bad\\n")',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('sys.stdout.write');
  });

  it('passes Python raw sys writes in protocol_output.py', async () => {
    const result = await check({
      'src/backend/scripts/python/lib/protocol_output.py': [
        'import sys',
        'def write_protocol_stdout(text):',
        '    sys.stdout.write(text)',
        'def write_protocol_stderr(text):',
        '    sys.stderr.write(text)',
      ].join('\n'),
    });

    expect(result.valid).toBe(true);
  });

  it('fails a Python protocol helper call in a non-allow-listed production file', async () => {
    const result = await check({
      'src/backend/scripts/python/lib/text.py': 'write_protocol_stdout("bad\\n")\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('write_protocol_stdout() is allowed only');
  });

  it('fails a Python protocol marker anywhere', async () => {
    const result = await check({
      'src/backend/scripts/python/lib/text.py': [
        '# tasksail: protocol-output',
        'write_protocol_stdout("bad\\n")',
      ].join('\n'),
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('protocol marker is allowed only');
  });

  it('fails console.log in a production electron file', async () => {
    const result = await check({
      'src/frontend/desktop/electron/main.contextPackCatalog.ts': 'console.log("bad");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('main.contextPackCatalog.ts');
    expect(result.errors.join('\n')).toContain('frontend Electron');
  });

  it('fails console.warn in electron main production code', async () => {
    const result = await check({
      'src/frontend/desktop/electron/main.ts': 'console.warn("bad");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('src/frontend/desktop/electron/main.ts');
  });

  it('allows console.error in frontend vite config', async () => {
    const result = await check({
      'src/frontend/desktop/vite.config.ts': 'console.error("dev restart failed");\n',
    });

    expect(result.valid).toBe(true);
  });

  it('fails console.warn in a production renderer file', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/hooks/useContextPackSelection.ts': 'console.warn("bad");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('useContextPackSelection.ts');
  });

  it('allows the commented renderer logger DevTools pass-through alias', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/log/logger.ts': [
        '// DevTools pass-through: renderer logs also go to IPC.',
        'const devToolsConsoleError = console.error.bind(console);',
      ].join('\n'),
    });

    expect(result.valid).toBe(true);
  });

  it('fails the renderer logger DevTools pass-through alias without the required comment', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/log/logger.ts': 'const devToolsConsoleError = console.error.bind(console);\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('renderer/log/logger.ts');
  });

  it('fails console aliasing outside the renderer logger', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/components/Widget.tsx': 'const warn = console.warn.bind(console);\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('Widget.tsx');
  });

  it('fails window.console access in renderer production code', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/hooks/useContextPackSelection.ts': 'window.console.warn("bad");\n',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('window.console.*');
  });

  it('ignores console.warn in renderer test files', async () => {
    const result = await check({
      'src/frontend/desktop/src/renderer/__tests__/anything.test.ts': 'console.warn("ok");\n',
    });

    expect(result.valid).toBe(true);
  });
});

async function findLiveProtocolHelperCallers(): Promise<string[]> {
  const files = await listSourceFiles(path.join(REPO_ROOT, 'src/backend'));
  const callers = new Set<string>();

  for (const file of files) {
    const relPath = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (shouldSkipProtocolAllowlistCensus(relPath)) {
      continue;
    }
    const source = await fs.promises.readFile(file, 'utf-8');
    if (relPath.endsWith('.ts') && TS_PROTOCOL_HELPER_CALL_RE.test(source)) {
      callers.add(relPath);
    }
    if (relPath.endsWith('.py') && PY_PROTOCOL_HELPER_CALL_RE.test(source)) {
      callers.add(relPath);
    }
  }

  return [...callers].sort();
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.py'))) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files;
}

function shouldSkipProtocolAllowlistCensus(relPath: string): boolean {
  return relPath.includes('/__tests__/')
    || relPath.includes('/dist/')
    || relPath.endsWith('.d.ts')
    || relPath === TS_PROTOCOL_OUTPUT_HELPER
    || relPath === 'src/backend/platform/core/index.ts'
    || relPath === PY_PROTOCOL_OUTPUT_HELPER;
}
