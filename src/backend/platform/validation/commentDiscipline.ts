import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as ts from 'typescript';
import { findRepoRoot, runPython } from '../core/index.js';
import { splitCommandOutputLines } from '../core/commandOutput.js';

const execFileAsync = promisify(execFile);
const PYTHON_TOKENIZER = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'scripts',
  'python',
  'lib',
  'comment_discipline_tokenize.py',
);
const PROTOCOL_OUTPUT_MARKER = ['tasksail:', 'protocol-output'].join(' ');

export type CommentDisciplineMode = 'report' | 'changed' | 'full';
export type CommentLanguage = 'typescript' | 'tsx' | 'python';
export type CommentKind =
  | 'line'
  | 'block'
  | 'jsdoc'
  | 'python-comment'
  | 'python-docstring'
  | 'jsx-comment';
export type CommentSeverity = 'error' | 'advisory';

export interface CommentToken {
  path: string;
  language: CommentLanguage;
  kind: CommentKind;
  startLine: number;
  endLine: number;
  text: string;
  normalizedText: string;
}

export interface CommentDisciplineViolation {
  path: string;
  line: number;
  endLine: number;
  ruleId: string;
  severity: CommentSeverity;
  message: string;
  snippet: string;
}

export interface CommentDisciplineResult {
  valid: boolean;
  errors: string[];
  violations: CommentDisciplineViolation[];
  advisory: CommentDisciplineViolation[];
}

export interface CommentDisciplineOptions {
  repoRoot?: string;
  mode?: CommentDisciplineMode;
  baseRef?: string;
  headRef?: string;
  staged?: boolean;
  paths?: string[];
}

interface SourceFile {
  path: string;
  content: string;
  language: CommentLanguage;
}

interface PythonTokenPayload {
  path: string;
  kind: 'python-comment' | 'python-docstring';
  startLine: number;
  endLine: number;
  text: string;
}

type ChangedRanges = Map<string, Array<{ start: number; end: number }>>;

const GENERATED_SEGMENTS = [
  '/node_modules/',
  '/dist/',
  '/dist-electron/',
  '/coverage/',
  '/.vite/',
  '/__pycache__/',
  '/.ruff_cache/',
];

const HARD_REFERENCE_RE =
  /^(phase\s+\d+(?:\.\d+)?|track\s+[a-z]|gate\s+g?\d+|g\d+|sec-[a-z0-9-]*\d+|eh-[a-z0-9-]*\d+|step\s+\d+(?:\s*[-–]\s*\d+)?|section\s+\d+(?:\.\d+)*|§\d+(?:\.\d+)*|spec ref)\b\s*:?\s*/i;
const BROAD_REFERENCE_RE =
  /\b(phase\s+\d+(?:\.\d+)?|track\s+[a-z]|gate\s+g?\d+|sec-[a-z0-9-]*\d+|eh-[a-z0-9-]*\d+|spec ref|as required by|per section|per phase)\b/i;
const TODO_RE = /\b(TODO|FIXME|HACK)\b(?!\([^)]+\):)/;
const NARRATION_RE =
  /^(create|set|get|call|return|verify|assert|mock|initialize|load|save|update|delete|render|build)\b/i;
const WEAK_WHY_RE =
  /^(this|function|method|class|component|test)\s+(returns|sets|gets|creates|updates|deletes|renders|checks)\b/i;
const TEST_LABEL_RE = /^(arrange|act|assert|setup|test case\s+\d+)\b/i;

export async function checkCommentDiscipline(
  options: CommentDisciplineOptions = {},
): Promise<CommentDisciplineResult> {
  const repoRoot = options.repoRoot ?? await findRepoRoot();
  const mode = options.mode ?? 'report';
  const ranges = await resolveChangedRanges(repoRoot, options);
  const sources = await loadSources(repoRoot, options, ranges);
  const tokens = await collectCommentTokens(repoRoot, sources);
  const allFindings = classifyTokens(tokens);
  const scopedFindings = allFindings.filter((finding) => (
    shouldIncludeFinding(finding, mode, ranges, options.staged)
  ));
  const hard = scopedFindings.filter((finding) => finding.severity === 'error');
  const advisory = scopedFindings.filter((finding) => finding.severity === 'advisory');
  const valid = mode === 'report' || hard.length === 0;
  const errors = hard.map(formatViolation);
  return { valid, errors, violations: hard, advisory };
}

export function formatCommentDisciplineText(result: CommentDisciplineResult): string {
  const lines: string[] = [];
  for (const violation of result.violations) {
    lines.push(`  [FAIL] ${formatViolation(violation)}`);
  }
  for (const advisory of result.advisory) {
    lines.push(`  [ADVISORY] ${formatViolation(advisory)}`);
  }
  if (lines.length === 0) {
    lines.push('Comment discipline: no findings.');
  }
  return `${lines.join('\n')}\n`;
}

async function loadSources(
  repoRoot: string,
  options: CommentDisciplineOptions,
  ranges: ChangedRanges | undefined,
): Promise<SourceFile[]> {
  const paths = options.staged
    ? [...(ranges?.keys() ?? [])]
    : options.paths ?? (ranges ? [...ranges.keys()] : await discoverSourceFiles(repoRoot));

  const sources: SourceFile[] = [];
  for (const relPath of paths.sort()) {
    const language = languageForPath(relPath);
    if (!language || !isInScope(relPath)) {
      continue;
    }
    const content = options.staged
      ? await readStagedBlob(repoRoot, relPath)
      : await readHeadOrWorkingTree(repoRoot, relPath, options.headRef);
    if (content === undefined) {
      continue;
    }
    sources.push({ path: normalizePath(relPath), content, language });
  }
  return sources;
}

async function discoverSourceFiles(repoRoot: string): Promise<string[]> {
  let files: string[];
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: repoRoot },
    );
    files = splitCommandOutputLines(stdout);
  } catch {
    files = await listFilesFallback(repoRoot);
  }
  return files.map(normalizePath).filter(isInScope).sort();
}

async function listFilesFallback(repoRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries: Array<Dirent<string>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = normalizePath(path.relative(repoRoot, fullPath));
      if (entry.isDirectory()) {
        if (!shouldExcludePath(relPath)) {
          await visit(fullPath);
        }
      } else if (entry.isFile() && isInScope(relPath)) {
        files.push(relPath);
      }
    }
  }
  await visit(repoRoot);
  return files;
}

function isInScope(relPath: string): boolean {
  const normalized = normalizePath(relPath);
  if (shouldExcludePath(normalized)) {
    return false;
  }
  if (normalized.startsWith('src/backend/platform/') && normalized.endsWith('.ts') && !normalized.endsWith('.d.ts')) {
    return true;
  }
  if (normalized.startsWith('src/backend/') && normalized.endsWith('.py')) {
    return true;
  }
  if (normalized.startsWith('tests/') && normalized.endsWith('.py')) {
    return true;
  }
  if (
    normalized.startsWith('src/frontend/desktop/')
    && (normalized.endsWith('.ts') || normalized.endsWith('.tsx'))
    && !normalized.endsWith('.d.ts')
  ) {
    return true;
  }
  return false;
}

function shouldExcludePath(relPath: string): boolean {
  const normalized = `/${normalizePath(relPath)}`;
  return normalized.startsWith('/.platform-state/')
    || normalized.startsWith('/AgentWorkSpace/')
    || GENERATED_SEGMENTS.some((segment) => normalized.includes(segment));
}

function languageForPath(relPath: string): CommentLanguage | undefined {
  if (relPath.endsWith('.tsx')) {
    return 'tsx';
  }
  if (relPath.endsWith('.ts')) {
    return 'typescript';
  }
  if (relPath.endsWith('.py')) {
    return 'python';
  }
  return undefined;
}

async function readHeadOrWorkingTree(
  repoRoot: string,
  relPath: string,
  headRef?: string,
): Promise<string | undefined> {
  if (headRef) {
    try {
      const { stdout } = await execFileAsync('git', ['show', `${headRef}:${relPath}`], {
        cwd: repoRoot,
        maxBuffer: 20 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return undefined;
    }
  }
  try {
    return await fs.readFile(path.join(repoRoot, relPath), 'utf-8');
  } catch {
    return undefined;
  }
}

async function readStagedBlob(repoRoot: string, relPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['show', `:${relPath}`], {
      cwd: repoRoot,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return undefined;
  }
}

async function resolveChangedRanges(
  repoRoot: string,
  options: CommentDisciplineOptions,
): Promise<ChangedRanges | undefined> {
  if (options.mode !== 'changed' && !options.staged) {
    return undefined;
  }
  if (options.staged) {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--cached', '--unified=0', '--diff-filter=ACMR'],
      { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 },
    );
    return parseChangedRanges(stdout);
  }
  const args = ['diff', '--unified=0', '--diff-filter=ACMR'];
  if (options.baseRef && options.headRef) {
    args.push(options.baseRef, options.headRef);
  } else if (options.baseRef) {
    args.push(options.baseRef);
  }
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseChangedRanges(stdout);
}

function parseChangedRanges(diffText: string): ChangedRanges {
  const ranges: ChangedRanges = new Map();
  let currentPath: string | undefined;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentPath = normalizePath(line.slice('+++ b/'.length));
      if (isInScope(currentPath) && !ranges.has(currentPath)) {
        ranges.set(currentPath, []);
      }
      continue;
    }
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match || !currentPath || !ranges.has(currentPath)) {
      continue;
    }
    const start = Number.parseInt(match[1]!, 10);
    const count = match[2] ? Number.parseInt(match[2], 10) : 1;
    if (count > 0) {
      ranges.get(currentPath)!.push({ start, end: start + count - 1 });
    }
  }
  return ranges;
}

async function collectCommentTokens(
  repoRoot: string,
  sources: SourceFile[],
): Promise<CommentToken[]> {
  const tsTokens = sources
    .filter((source) => source.language !== 'python')
    .flatMap(extractTypeScriptTokens);
  const pythonTokens = await extractPythonTokens(repoRoot, sources.filter((source) => source.language === 'python'));
  return [...tsTokens, ...pythonTokens].sort(compareTokens);
}

function extractTypeScriptTokens(source: SourceFile): CommentToken[] {
  const variant = source.language === 'tsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, variant, source.content);
  const tokens: CommentToken[] = [];
  const seen = new Set<string>();

  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const kind = scanner.getToken();
    if (
      kind !== ts.SyntaxKind.SingleLineCommentTrivia
      && kind !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    if (kind === ts.SyntaxKind.MultiLineCommentTrivia && startsInsideLineComment(source.content, start)) {
      continue;
    }
    const key = `${start}:${end}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const text = source.content.slice(start, end);
    const commentKind = kind === ts.SyntaxKind.SingleLineCommentTrivia
      ? 'line'
      : text.startsWith('/**') ? 'jsdoc' : 'block';
    tokens.push({
      path: source.path,
      language: source.language,
      kind: commentKind,
      startLine: lineForPosition(source.content, start),
      endLine: lineForPosition(source.content, Math.max(start, end - 1)),
      text,
      normalizedText: normalizeCommentText(commentKind, text),
    });
  }
  return tokens;
}

function startsInsideLineComment(content: string, position: number): boolean {
  const lineStart = content.lastIndexOf('\n', position - 1) + 1;
  const before = content.slice(lineStart, position);
  return /^\s*\/\//.test(before);
}

async function extractPythonTokens(
  repoRoot: string,
  sources: SourceFile[],
): Promise<CommentToken[]> {
  if (sources.length === 0) {
    return [];
  }
  const payload = sources.map(({ path: relPath, content }) => ({ path: relPath, content }));
  const result = await runPython(PYTHON_TOKENIZER, [], {
    cwd: repoRoot,
    stdin: JSON.stringify(payload),
    timeout: 120_000,
  });
  const parsed = JSON.parse(result.stdout) as PythonTokenPayload[];
  return parsed.map((token) => ({
    path: normalizePath(token.path),
    language: 'python',
    kind: token.kind,
    startLine: token.startLine,
    endLine: token.endLine,
    text: token.text,
    normalizedText: normalizeCommentText(token.kind, token.text),
  }));
}

function classifyTokens(tokens: CommentToken[]): CommentDisciplineViolation[] {
  const findings: CommentDisciplineViolation[] = [];
  for (const token of tokens) {
    findings.push(...classifySingleToken(token));
  }
  findings.push(...classifyLineGroups(tokens));
  findings.push(...classifyFileDensity(tokens));
  return findings.sort(compareViolations);
}

function classifySingleToken(token: CommentToken): CommentDisciplineViolation[] {
  if (isDirectiveOrProtected(token)) {
    return [];
  }
  const findings: CommentDisciplineViolation[] = [];
  const normalized = token.normalizedText.trim();
  if (!normalized) {
    return findings;
  }

  if (isOrdinaryComment(token) && /^[=\-_*#/|~\s]+$/.test(normalized) && normalized.length >= 3) {
    findings.push(makeViolation(token, 'comment.decorative-separator', 'error', 'Decorative separator comments are not allowed.'));
  }
  if (isOrdinaryComment(token) && HARD_REFERENCE_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.process-reference-label', 'error', 'Remove planning/process labels from source comments.'));
  } else if (BROAD_REFERENCE_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.reference-wording', 'advisory', 'Review planning/reference wording and keep only operational meaning.'));
  }
  if (isOrdinaryComment(token) && looksLikeDisabledSource(token)) {
    findings.push(makeViolation(token, 'comment.disabled-source', 'error', 'Disabled source statements need prose or should be removed.'));
  }
  if (isOrdinaryComment(token)) {
    findings.push(...classifyLength(token));
  } else if ((token.kind === 'jsdoc' || token.kind === 'python-docstring') && wordCount(normalized) > 120) {
    findings.push(makeViolation(token, 'comment.long-doc', 'advisory', 'Long JSDoc/docstrings are advisory in this implementation.'));
  }
  if (TODO_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.todo-format', 'advisory', 'TODO/FIXME/HACK comments need review and an approved owner format.'));
  }
  if (TEST_LABEL_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.test-label', 'advisory', 'Test section labels are often redundant; review for value.'));
  } else if (NARRATION_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.obvious-narration', 'advisory', 'This may narrate what the code already says.'));
  }
  if (WEAK_WHY_RE.test(normalized)) {
    findings.push(makeViolation(token, 'comment.weak-why', 'advisory', 'Prefer comments that explain why, not what.'));
  }
  return dedupeViolations(findings);
}

function classifyLength(token: CommentToken): CommentDisciplineViolation[] {
  const paragraphs = paragraphsFor(token.normalizedText);
  const findings: CommentDisciplineViolation[] = [];
  const nonblankLines = token.normalizedText.split('\n').filter((line) => line.trim()).length;
  if (token.kind === 'block' && nonblankLines > 14) {
    findings.push(makeViolation(token, 'comment.excessive-length', 'error', 'Ordinary block comments may not exceed 14 nonblank lines.'));
  }
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').filter((line) => line.trim()).length;
    if (lines > 8 || wordCount(paragraph) > 120) {
      findings.push(makeViolation(token, 'comment.excessive-length', 'error', 'Ordinary comment paragraphs are too long.'));
      break;
    }
  }
  return findings;
}

function classifyLineGroups(tokens: CommentToken[]): CommentDisciplineViolation[] {
  const findings: CommentDisciplineViolation[] = [];
  const ordinaryLines = tokens.filter((token) => (
    isOrdinaryComment(token)
    && (token.kind === 'line' || token.kind === 'python-comment')
    && !isDirectiveOrProtected(token)
  ));
  let group: CommentToken[] = [];
  for (const token of ordinaryLines) {
    const last = group.at(-1);
    if (last && last.path === token.path && token.startLine === last.endLine + 1) {
      group.push(token);
    } else {
      findings.push(...finishLineGroup(group));
      group = [token];
    }
  }
  findings.push(...finishLineGroup(group));
  return findings;
}

function finishLineGroup(group: CommentToken[]): CommentDisciplineViolation[] {
  if (group.length <= 6) {
    return [];
  }
  const first = group[0]!;
  return [makeViolation(
    {
      ...first,
      endLine: group.at(-1)!.endLine,
      text: group.map((token) => token.text).join('\n'),
      normalizedText: group.map((token) => token.normalizedText).join('\n'),
    },
    'comment.excessive-length',
    'error',
    'More than 6 consecutive ordinary line comments are not allowed.',
  )];
}

function classifyFileDensity(tokens: CommentToken[]): CommentDisciplineViolation[] {
  const byPath = new Map<string, CommentToken[]>();
  for (const token of tokens.filter((item) => !isDirectiveOrProtected(item))) {
    byPath.set(token.path, [...(byPath.get(token.path) ?? []), token]);
  }
  const findings: CommentDisciplineViolation[] = [];
  for (const [relPath, fileTokens] of byPath) {
    const totalCommentLines = fileTokens.reduce((sum, token) => sum + token.endLine - token.startLine + 1, 0);
    const maxLine = Math.max(...fileTokens.map((token) => token.endLine), 1);
    if (fileTokens.length >= 20 && totalCommentLines / maxLine > 0.35) {
      findings.push({
        path: relPath,
        line: 1,
        endLine: 1,
        ruleId: 'comment.high-density',
        severity: 'advisory',
        message: 'High comment density is advisory and should be reviewed for signal/noise.',
        snippet: `${totalCommentLines} comment lines across ${maxLine} source lines`,
      });
    }
  }
  return findings;
}

function shouldIncludeFinding(
  finding: CommentDisciplineViolation,
  mode: CommentDisciplineMode,
  ranges: ChangedRanges | undefined,
  staged?: boolean,
): boolean {
  if (mode !== 'changed' && !staged) {
    return true;
  }
  if (!ranges) {
    return false;
  }
  const fileRanges = ranges.get(finding.path);
  if (!fileRanges) {
    return false;
  }
  return fileRanges.some((range) => range.start <= finding.endLine && range.end >= finding.line);
}

function isOrdinaryComment(token: CommentToken): boolean {
  return token.kind === 'line'
    || token.kind === 'block'
    || token.kind === 'python-comment'
    || token.kind === 'jsx-comment';
}

function isDirectiveOrProtected(token: CommentToken): boolean {
  const raw = token.text.trim();
  const normalized = token.normalizedText.trim();
  if (!normalized) {
    return true;
  }
  if (/copyright|license/i.test(normalized)) {
    return true;
  }
  if (normalized.includes(PROTOCOL_OUTPUT_MARKER)) {
    return true;
  }
  if (token.kind === 'line' || token.kind === 'block' || token.kind === 'jsdoc') {
    return /@ts-expect-error|@ts-ignore|eslint|istanbul|vitest-environment|@vitest-environment|@jsxImportSource|^\/?\s*<reference\b|sourceMappingURL/i.test(normalized);
  }
  if (token.kind === 'python-comment') {
    return raw.startsWith('#!')
      || /coding[:=]\s*[-\w.]+/.test(raw)
      || /\b(noqa|type:\s*ignore|pragma:\s*no cover|pylint:|pyright:|mypy:)/i.test(normalized);
  }
  return false;
}

function looksLikeDisabledSource(token: CommentToken): boolean {
  const normalized = token.normalizedText.trim();
  if (!normalized || normalized.includes(' ')) {
    return codeLikeWithSpaces(token, normalized);
  }
  return codeLikeWithoutSpaces(token, normalized);
}

function codeLikeWithSpaces(token: CommentToken, normalized: string): boolean {
  if (/[.!?]\s+[A-Z]/.test(normalized)) {
    return false;
  }
  if (token.language === 'python') {
    return /^(from\s+\S+\s+import\s+\S+|import\s+\S+|def\s+\w+\(.*\):|class\s+\w+.*:|return\s+[^.]+$|if\s+.+:$|for\s+.+:$|while\s+.+:$|with\s+.+:$|print\(.*\)$|raise\s+\w+)/.test(normalized);
  }
  return /^((const|let|var)\s+\w+\s*=.+;|function\s+\w+\(.*\)\s*\{|class\s+\w+|import\s+.+from\s+.+;|export\s+.+;|return\s+.+;|if\s*\(.*\)\s*\{|for\s*\(.*\)\s*\{|while\s*\(.*\)\s*\{|switch\s*\(.*\)\s*\{|throw\s+.+;|await\s+.+;|expect\s*\(.+\);|console\.\w+\(.+\);)$/.test(normalized);
}

function codeLikeWithoutSpaces(token: CommentToken, normalized: string): boolean {
  if (token.language === 'python') {
    return /^(print|return|raise)\(|\w+\s*=/.test(normalized);
  }
  return /^[}\]);]+;?$/.test(normalized) || /^[A-Za-z_$][\w$]*\([^)]*\);$/.test(normalized);
}

function paragraphsFor(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function makeViolation(
  token: CommentToken,
  ruleId: string,
  severity: CommentSeverity,
  message: string,
): CommentDisciplineViolation {
  return {
    path: token.path,
    line: token.startLine,
    endLine: token.endLine,
    ruleId,
    severity,
    message,
    snippet: snippetFor(token.normalizedText),
  };
}

function dedupeViolations(findings: CommentDisciplineViolation[]): CommentDisciplineViolation[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.path}:${finding.line}:${finding.ruleId}:${finding.severity}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function snippetFor(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  return compact.length > 100 ? `${compact.slice(0, 97)}...` : compact;
}

function formatViolation(violation: CommentDisciplineViolation): string {
  return `${violation.path}:${violation.line}: ${violation.ruleId}: ${violation.message}: ${violation.snippet}`;
}

function normalizeCommentText(kind: CommentKind, text: string): string {
  if (kind === 'line') {
    return text.replace(/^\/\/\/?/, '').trim();
  }
  if (kind === 'python-comment') {
    return text.replace(/^#\s?/, '').trim();
  }
  if (kind === 'python-docstring') {
    return text
      .replace(/^[rubfRUBF]*("""|''')/, '')
      .replace(/("""|''')$/, '')
      .trim();
  }
  return text
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trimEnd())
    .join('\n')
    .trim();
}

function lineForPosition(text: string, position: number): number {
  return ts.getLineAndCharacterOfPosition(ts.createSourceFile('comment-discipline.ts', text, ts.ScriptTarget.Latest), position).line + 1;
}

function compareTokens(a: CommentToken, b: CommentToken): number {
  return a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine;
}

function compareViolations(a: CommentDisciplineViolation, b: CommentDisciplineViolation): number {
  return a.path.localeCompare(b.path) || a.line - b.line || a.ruleId.localeCompare(b.ruleId);
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/');
}
