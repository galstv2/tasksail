import * as fs from 'node:fs';
import * as path from 'node:path';
import { findRepoRoot } from '../core/index.js';

export interface LoggingDisciplineViolation {
  path: string;
  line: number;
  message: string;
  snippet: string;
}

export interface LoggingDisciplineResult {
  valid: boolean;
  errors: string[];
  violations: LoggingDisciplineViolation[];
}

export interface LoggingDisciplineOptions {
  repoRoot?: string;
}

const PROTOCOL_MARKER = 'tasksail: protocol-output';
const TS_STD_WRITE_RE = /\bprocess\.std(out|err)\.write\s*\(/g;
const TS_CONSOLE_RE = /\bconsole\.(log|warn|error|info|debug)\s*\(/g;
const FRONTEND_CONSOLE_RE = /\b(?:window\.)?console\.(log|warn|error|info|debug)\b/g;
const TS_PROTOCOL_HELPER_CALL_RE = /\bwriteProtocol(?:Stdout|Stderr|Json)\s*\(/g;
const PY_PRINT_RE = /(^|[^\w.])print\s*\(/g;
const PY_STD_WRITE_RE = /\bsys\.std(out|err)\.write\s*\(/g;
const PY_PROTOCOL_HELPER_CALL_RE = /\bwrite_protocol_(?:stdout|stderr|json)\s*\(/g;
const TS_PROTOCOL_OUTPUT_HELPER = 'src/backend/platform/core/protocolOutput.ts';
const TS_LOGGER = 'src/backend/platform/core/logger.ts';
const PY_PROTOCOL_OUTPUT_HELPER = 'src/backend/scripts/python/lib/protocol_output.py';
const FRONTEND_VITE_CONFIG = 'src/frontend/desktop/vite.config.ts';
const RENDERER_LOGGER = 'src/frontend/desktop/src/renderer/log/logger.ts';
const PROTOCOL_ALLOWLIST_RELATIVE_PATH = 'src/backend/platform/validation/protocolOutputAllowlist.json';
const ALLOWED_LOGGER_STDERR = new Set([
  'src/backend/platform/core/logger.ts',
  'src/backend/platform/core/logger/writer.ts',
]);
const ALLOWED_PYTHON_STDERR = new Set([
  PY_PROTOCOL_OUTPUT_HELPER,
  'src/backend/scripts/python/lib/level_router.py',
  'src/backend/scripts/python/lib/log_paths.py',
]);

interface SourceLine {
  raw: string;
  code: string;
}

interface ProtocolUse {
  line: number;
  kind: 'ts-stdout' | 'ts-stderr';
}

export async function checkLoggingDiscipline(
  options?: LoggingDisciplineOptions,
): Promise<LoggingDisciplineResult> {
  const repoRoot = options?.repoRoot ?? await findRepoRoot();
  const allowlist = await loadProtocolAllowlist(repoRoot);
  const violations: LoggingDisciplineViolation[] = [];

  for (const file of await listFiles(path.join(repoRoot, 'src', 'backend', 'platform'), '.ts')) {
    const relPath = normalizeRelativePath(repoRoot, file);
    if (shouldSkipTypeScript(relPath)) {
      continue;
    }
    violations.push(...await checkTypeScriptFile(file, relPath, allowlist));
  }
  violations.push(...await checkLoggerDoesNotReferenceProtocolOutput(repoRoot));

  for (const file of await listFiles(path.join(repoRoot, 'src', 'frontend', 'desktop', 'electron'), '.ts')) {
    const relPath = normalizeRelativePath(repoRoot, file);
    if (shouldSkipFrontendTypeScript(relPath)) {
      continue;
    }
    violations.push(...await checkFrontendElectronFile(file, relPath));
  }

  violations.push(...await checkFrontendElectronFile(
    path.join(repoRoot, FRONTEND_VITE_CONFIG),
    FRONTEND_VITE_CONFIG,
  ));

  for (const file of await listFilesByExtensions(
    path.join(repoRoot, 'src', 'frontend', 'desktop', 'src', 'renderer'),
    ['.ts', '.tsx'],
  )) {
    const relPath = normalizeRelativePath(repoRoot, file);
    if (shouldSkipFrontendTypeScript(relPath)) {
      continue;
    }
    violations.push(...await checkFrontendRendererFile(file, relPath));
  }

  for (const file of await listFiles(path.join(repoRoot, 'src', 'backend'), '.py')) {
    const relPath = normalizeRelativePath(repoRoot, file);
    if (shouldSkipPython(relPath)) {
      continue;
    }
    violations.push(...await checkPythonFile(file, relPath, allowlist));
  }

  const errors = violations.map((violation) => (
    `${violation.path}:${violation.line}: ${violation.message}: ${violation.snippet}`
  ));
  if (errors.length > 0) {
    errors.unshift(`Logging discipline validation failed. Protocol output must be marked and listed in ${PROTOCOL_ALLOWLIST_RELATIVE_PATH}.`);
  }

  return { valid: violations.length === 0, errors, violations };
}

async function checkLoggerDoesNotReferenceProtocolOutput(
  repoRoot: string,
): Promise<LoggingDisciplineViolation[]> {
  const loggerPath = path.join(repoRoot, TS_LOGGER);
  if (!await fileExists(loggerPath)) {
    return [];
  }
  const lines = await readLines(loggerPath);
  const violations: LoggingDisciplineViolation[] = [];
  lines.forEach((line, index) => {
    if (line.includes('protocolOutput')) {
      violations.push(violation(
        TS_LOGGER,
        index,
        'logger.ts must not import or reference protocolOutput',
        line,
      ));
    }
  });
  return violations;
}

async function loadProtocolAllowlist(repoRoot: string): Promise<Set<string>> {
  const configFile = await resolveProtocolAllowlistConfigFile(repoRoot);
  const raw = await fs.promises.readFile(configFile, 'utf-8');
  return parseProtocolAllowlist(raw, configFile);
}

async function resolveProtocolAllowlistConfigFile(repoRoot: string): Promise<string> {
  const repoCandidate = path.join(repoRoot, PROTOCOL_ALLOWLIST_RELATIVE_PATH);
  if (await fileExists(repoCandidate)) {
    return repoCandidate;
  }
  return path.join(import.meta.dirname, 'protocolOutputAllowlist.json');
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function parseProtocolAllowlist(raw: string, configFile: string): Set<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: expected an object`);
  }

  const payload = parsed as { schema_version?: unknown; files?: unknown };
  if (payload.schema_version !== 1) {
    throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: schema_version must be 1`);
  }
  if (!Array.isArray(payload.files)) {
    throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: files must be an array`);
  }

  const allowlist = new Set<string>();
  payload.files.forEach((file, index) => {
    if (typeof file !== 'string' || file.length === 0) {
      throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: files[${index}] must be a non-empty string`);
    }
    const normalized = file.replace(/\\/g, '/');
    if (normalized !== file || path.posix.isAbsolute(normalized) || normalized.includes('..')) {
      throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: files[${index}] must be a normalized repo-relative path`);
    }
    if (allowlist.has(normalized)) {
      throw new Error(`Invalid protocol output allowlist JSON at ${configFile}: duplicate file ${normalized}`);
    }
    allowlist.add(normalized);
  });

  return allowlist;
}

async function listFiles(root: string, extension: string): Promise<string[]> {
  return listFilesByExtensions(root, [extension]);
}

async function listFilesByExtensions(root: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && extensions.some((extension) => fullPath.endsWith(extension))) {
        files.push(fullPath);
      }
    }
  }
  await visit(root);
  return files.sort();
}

function shouldSkipTypeScript(relPath: string): boolean {
  return relPath.includes('/__tests__/')
    || relPath.includes('/dist/')
    || relPath.endsWith('.d.ts');
}

function shouldSkipFrontendTypeScript(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  return relPath.includes('/__tests__/')
    || relPath.includes('/dist/')
    || relPath.includes('/dist-electron/')
    || relPath.endsWith('.d.ts')
    || base.includes('.test.');
}

function shouldSkipPython(relPath: string): boolean {
  const base = path.posix.basename(relPath);
  return relPath.includes('/__pycache__/')
    || relPath.includes('/tests/')
    || relPath.includes('/test/')
    || base.startsWith('test_')
    || base.endsWith('_test.py');
}

async function checkTypeScriptFile(
  file: string,
  relPath: string,
  allowlist: Set<string>,
): Promise<LoggingDisciplineViolation[]> {
  const lines = stripComments(await readLines(file));
  const violations: LoggingDisciplineViolation[] = [];
  const protocolUses = new Map<number, ProtocolUse[]>();

  lines.forEach((line, index) => {
    TS_CONSOLE_RE.lastIndex = 0;
    if (TS_CONSOLE_RE.test(line.code)) {
      violations.push(violation(relPath, index, 'console.* is forbidden in production backend TypeScript', line.raw));
    }

    TS_STD_WRITE_RE.lastIndex = 0;
    for (const match of line.code.matchAll(TS_STD_WRITE_RE)) {
      const kind = match[1] === 'out' ? 'ts-stdout' : 'ts-stderr';
      addProtocolUse(protocolUses, index + 1, { line: index + 1, kind });
      if (
        kind === 'ts-stderr'
        && ALLOWED_LOGGER_STDERR.has(relPath)
        && !hasMarker(lines[index - 1])
      ) {
        continue;
      }
      if (relPath !== TS_PROTOCOL_OUTPUT_HELPER || !isMarkedProtocolUse(lines, index)) {
        const rawWriteName = kind === 'ts-stdout'
          ? 'process' + '.stdout.write'
          : 'process' + '.stderr.write';
        violations.push(violation(
          relPath,
          index,
          `${rawWriteName} is allowed only in the protocol output helper or logger stderr internals`,
          line.raw,
        ));
      }
    }

    TS_PROTOCOL_HELPER_CALL_RE.lastIndex = 0;
    for (const match of line.code.matchAll(TS_PROTOCOL_HELPER_CALL_RE)) {
      const call = match[0].slice(0, -1);
      if (relPath === TS_PROTOCOL_OUTPUT_HELPER || relPath === 'src/backend/platform/core/index.ts') {
        continue;
      }
      if (!allowlist.has(relPath)) {
        violations.push(violation(
          relPath,
          index,
          `${call}() is allowed only in protocol-allowlisted production files`,
          line.raw,
        ));
      }
    }
  });

  violations.push(...checkProtocolMarkers(lines, relPath, protocolUses));
  return violations;
}

async function checkFrontendElectronFile(
  file: string,
  relPath: string,
): Promise<LoggingDisciplineViolation[]> {
  if (!fs.existsSync(file)) {
    return [];
  }
  const rawLines = await readLines(file);
  const lines = stripComments(rawLines);
  const violations: LoggingDisciplineViolation[] = [];

  lines.forEach((line, index) => {
    FRONTEND_CONSOLE_RE.lastIndex = 0;
    for (const _match of line.code.matchAll(FRONTEND_CONSOLE_RE)) {
      if (relPath === FRONTEND_VITE_CONFIG) {
        continue;
      }
      violations.push(violation(
        relPath,
        index,
        'console.* is forbidden in production frontend Electron TypeScript',
        line.raw,
      ));
    }
  });

  return violations;
}

async function checkFrontendRendererFile(
  file: string,
  relPath: string,
): Promise<LoggingDisciplineViolation[]> {
  if (!fs.existsSync(file)) {
    return [];
  }
  const rawLines = await readLines(file);
  const lines = stripComments(rawLines);
  const violations: LoggingDisciplineViolation[] = [];
  let allowedDevToolsPassThroughCount = 0;

  lines.forEach((line, index) => {
    FRONTEND_CONSOLE_RE.lastIndex = 0;
    for (const match of line.code.matchAll(FRONTEND_CONSOLE_RE)) {
      if (isAllowedRendererLoggerDevToolsPassThrough(relPath, lines, index, match.index ?? 0)) {
        allowedDevToolsPassThroughCount += 1;
        continue;
      }
      violations.push(violation(
        relPath,
        index,
        'console.* and window.console.* are forbidden in production frontend renderer code',
        line.raw,
      ));
    }
  });

  if (relPath === RENDERER_LOGGER && allowedDevToolsPassThroughCount > 1) {
    violations.push({
      path: relPath,
      line: 1,
      message: 'renderer logger may allow exactly one DevTools pass-through '
        + 'console' + '.error.bind(console)',
      snippet: '',
    });
  }

  return violations;
}

function isAllowedRendererLoggerDevToolsPassThrough(
  relPath: string,
  lines: SourceLine[],
  index: number,
  matchIndex: number,
): boolean {
  if (relPath !== RENDERER_LOGGER) {
    return false;
  }
  const codeFromMatch = lines[index]?.code.slice(matchIndex).trim() ?? '';
  if (!codeFromMatch.startsWith('console' + '.error.bind(console)')) {
    return false;
  }
  const preceding = findPrecedingNonBlankRawLine(lines, index);
  return /DevTools/.test(preceding) && /pass-through/.test(preceding);
}

function findPrecedingNonBlankRawLine(lines: SourceLine[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const raw = lines[cursor]?.raw ?? '';
    if (raw.trim().length > 0) {
      return raw;
    }
  }
  return '';
}

async function checkPythonFile(
  file: string,
  relPath: string,
  allowlist: Set<string>,
): Promise<LoggingDisciplineViolation[]> {
  const lines = stripComments(await readLines(file));
  const violations: LoggingDisciplineViolation[] = [];
  const protocolUses = new Map<number, ProtocolUse[]>();

  lines.forEach((line, index) => {
    PY_PRINT_RE.lastIndex = 0;
    const printMatches = Array.from(line.code.matchAll(PY_PRINT_RE));
    for (let matchIndex = 0; matchIndex < printMatches.length; matchIndex += 1) {
      violations.push(violation(
        relPath,
        index,
        'print() is forbidden in production backend Python; use protocol_output helpers for command output',
        line.raw,
      ));
    }

    PY_STD_WRITE_RE.lastIndex = 0;
    for (const match of line.code.matchAll(PY_STD_WRITE_RE)) {
      const kind = match[1] === 'out' ? 'sys.stdout.write' : 'sys.stderr.write';
      if (
        (kind === 'sys.stdout.write' && relPath === PY_PROTOCOL_OUTPUT_HELPER)
        || (kind === 'sys.stderr.write' && ALLOWED_PYTHON_STDERR.has(relPath))
      ) {
        continue;
      }
      violations.push(violation(
        relPath,
        index,
        `${kind} is allowed only in protocol_output.py or Python logger stderr internals`,
        line.raw,
      ));
    }

    PY_PROTOCOL_HELPER_CALL_RE.lastIndex = 0;
    for (const match of line.code.matchAll(PY_PROTOCOL_HELPER_CALL_RE)) {
      const call = match[0].slice(0, -1);
      if (relPath === PY_PROTOCOL_OUTPUT_HELPER || isPythonProtocolHelperDefinition(line.code)) {
        continue;
      }
      if (!allowlist.has(relPath)) {
        violations.push(violation(
          relPath,
          index,
          `${call}() is allowed only in protocol-allowlisted production files`,
          line.raw,
        ));
      }
    }
  });

  violations.push(...checkProtocolMarkers(lines, relPath, protocolUses));
  return violations;
}

async function readLines(file: string): Promise<string[]> {
  return (await fs.promises.readFile(file, 'utf-8')).split(/\r?\n/);
}

function stripComments(rawLines: string[]): SourceLine[] {
  let inBlock = false;
  return rawLines.map((raw) => {
    let code = '';
    for (let index = 0; index < raw.length; index += 1) {
      const pair = raw.slice(index, index + 2);
      if (inBlock) {
        if (pair === '*/') {
          inBlock = false;
          index += 1;
        }
        continue;
      }
      if (pair === '/*') {
        inBlock = true;
        index += 1;
        continue;
      }
      if (pair === '//' || raw[index] === '#') {
        break;
      }
      code += raw[index];
    }
    return { raw, code };
  });
}

function isMarkedProtocolUse(
  lines: SourceLine[],
  index: number,
): boolean {
  return index > 0 && hasMarker(lines[index - 1]);
}

function checkProtocolMarkers(
  lines: SourceLine[],
  relPath: string,
  protocolUses: Map<number, ProtocolUse[]>,
): LoggingDisciplineViolation[] {
  const violations: LoggingDisciplineViolation[] = [];
  lines.forEach((line, index) => {
    if (!hasMarker(line)) {
      return;
    }
    if (relPath !== TS_PROTOCOL_OUTPUT_HELPER) {
      violations.push(violation(relPath, index, 'protocol marker is allowed only in the TypeScript protocol output helper', line.raw));
      return;
    }

    const next = lines[index + 1];
    const nextUses = protocolUses.get(index + 2) ?? [];
    if (!next || next.raw.trim() === '' || nextUses.length === 0) {
      violations.push(violation(relPath, index, 'protocol marker must be immediately followed by one protocol output call', line.raw));
      return;
    }
    if (nextUses.length > 1) {
      violations.push(violation(relPath, index + 1, 'one protocol marker may authorize only one protocol output call', next.raw));
    }
  });
  return violations;
}

function addProtocolUse(
  protocolUses: Map<number, ProtocolUse[]>,
  line: number,
  use: ProtocolUse,
): void {
  const uses = protocolUses.get(line);
  if (uses) {
    uses.push(use);
    return;
  }
  protocolUses.set(line, [use]);
}

function hasMarker(line: SourceLine | undefined): boolean {
  return line !== undefined
    && line.raw.includes(PROTOCOL_MARKER)
    && !line.code.includes(PROTOCOL_MARKER);
}

function isPythonProtocolHelperDefinition(code: string): boolean {
  return /^\s*def\s+write_protocol_(?:stdout|stderr|json)\s*\(/.test(code);
}

function violation(
  relPath: string,
  zeroBasedLine: number,
  message: string,
  raw: string,
): LoggingDisciplineViolation {
  return {
    path: relPath,
    line: zeroBasedLine + 1,
    message,
    snippet: raw.trim(),
  };
}

function normalizeRelativePath(repoRoot: string, fullPath: string): string {
  return path.relative(repoRoot, fullPath).replace(/\\/g, '/');
}
