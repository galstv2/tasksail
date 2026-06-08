import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { findRepoRoot } from '../core/index.js';

const execFileAsync = promisify(execFile);

const EXCEPTIONS_PATH = path.join(
  'src',
  'backend',
  'platform',
  'validation',
  'data',
  'open-source-readiness-exceptions.json',
);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.csv',
  '.env',
  '.example',
  '.gitignore',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.lock',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const GENERATED_PATH_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  'dist',
  'dist-electron',
  'release',
]);

const ALLOWED_HOME_NAMES = new Set([
  'agent',
  'bar',
  'baz',
  'dev',
  'developer',
  'example',
  'foo',
  'operator',
  'ops',
  'runner',
  'sample',
  'task',
  'tasksail',
  'test',
  'user',
]);

const REQUIRED_THIRD_PARTY_TERMS = [
  'TaskSail',
  'Electron',
  'React',
  'fonts',
  'OFL',
  'development',
  'dev-only',
];

const REQUIRED_PACKAGED_LICENSE_FILES = [
  'LICENSE',
  'THIRD_PARTY_LICENSES.md',
  'OFL-Outfit.txt',
  'OFL-SourceCodePro.txt',
];

const ALLOWED_TRACKED_BUILD_FILES = new Set([
  'src/frontend/desktop/build/icon.png',
  'src/frontend/desktop/build/icon@2x.png',
  'src/frontend/desktop/build/icon.svg',
]);

const HIGH_CONFIDENCE_SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/u,
  },
  {
    name: 'GitHub token',
    pattern: /\bgh[opsu]_[A-Za-z0-9_]{36,}\b/u,
  },
  {
    name: 'OpenAI API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    name: 'Slack token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  },
  {
    name: 'private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
  },
  {
    name: 'password assignment',
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{12,}['"]/iu,
  },
];

export interface OpenSourceReadinessOptions {
  repoRoot?: string;
}

export interface OpenSourceReadinessSummary {
  repoRoot: string;
  trackedFiles: number;
  checkedTextFiles: number;
  assetFiles: string[];
  packageFilesChecked: number;
  pnpmImporters: string[];
}

export interface OpenSourceReadinessResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: OpenSourceReadinessSummary;
}

interface ExceptionsFile {
  pnpmLockImporterExceptions?: Array<{
    importer?: string;
    reason?: string;
  }>;
}

export function formatOpenSourceReadinessText(result: OpenSourceReadinessResult): string {
  const lines: string[] = [];
  for (const warning of result.warnings) {
    lines.push(`  [WARN] ${warning}`);
  }
  for (const error of result.errors) {
    lines.push(`  [FAIL] ${error}`);
  }
  if (result.valid) {
    lines.push(
      `Open-source readiness passed for ${result.summary.trackedFiles} tracked files and ${result.summary.packageFilesChecked} packaged files.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function checkOpenSourceReadiness(
  options: OpenSourceReadinessOptions = {},
): Promise<OpenSourceReadinessResult> {
  const repoRoot = options.repoRoot ?? await findRepoRoot();
  const errors: string[] = [];
  const warnings: string[] = [];
  const trackedFiles = await listTrackedFiles(repoRoot, errors);
  const assetFiles = trackedFiles.filter(isAssetPath);
  const pnpmImporters = await extractPnpmImporters(repoRoot, errors);
  let checkedTextFiles = 0;

  await checkLegalFiles(repoRoot, errors);
  await checkPackageMetadata(repoRoot, errors);
  await checkThirdPartyNotice(repoRoot, errors);
  await checkAssetProvenance(repoRoot, trackedFiles, errors);
  await checkPnpmImporters(repoRoot, pnpmImporters, errors);
  checkTrackedReleaseBoundary(trackedFiles, errors);

  for (const relativePath of trackedFiles) {
    if (!shouldScanText(relativePath)) continue;
    const content = await readTextFile(path.join(repoRoot, relativePath));
    if (content === null) continue;
    checkedTextFiles += 1;
    checkPersonalPathText(relativePath, content, errors);
    checkSecretText(relativePath, content, errors);
  }

  const packageFilesChecked = await checkPackagedOutput(repoRoot, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      repoRoot,
      trackedFiles: trackedFiles.length,
      checkedTextFiles,
      assetFiles,
      packageFilesChecked,
      pnpmImporters,
    },
  };
}

async function listTrackedFiles(repoRoot: string, errors: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '--cached'], {
      cwd: repoRoot,
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout
      .split(/\r?\n/u)
      .map((line) => normalizeRelativePath(line.trim()))
      .filter(Boolean);
  } catch (error) {
    errors.push(`Unable to list tracked files with git: ${errorMessage(error)}`);
    return [];
  }
}

async function checkLegalFiles(repoRoot: string, errors: string[]): Promise<void> {
  const license = await readRequiredText(repoRoot, 'LICENSE', errors);
  if (license !== null && !/\bMIT License\b/u.test(license)) {
    errors.push('LICENSE must contain the MIT License text.');
  }

  const readme = await readRequiredText(repoRoot, 'README.md', errors);
  if (readme !== null && (!/\bMIT\b/u.test(readme) || !/\bLICENSE\b/u.test(readme))) {
    errors.push('README.md must state the MIT license and link or refer to LICENSE.');
  }

  const validationDoc = await readRequiredText(
    repoRoot,
    path.join('docs', 'technical', 'operations', 'validation-and-exit-codes.md'),
    errors,
  );
  if (validationDoc !== null && !validationDoc.includes('pnpm run check-open-source-readiness')) {
    errors.push('Validation documentation must include pnpm run check-open-source-readiness.');
  }
}

async function checkPackageMetadata(repoRoot: string, errors: string[]): Promise<void> {
  await checkPackageJson(repoRoot, 'package.json', errors);
  await checkPackageJson(
    repoRoot,
    path.join('src', 'frontend', 'desktop', 'package.json'),
    errors,
    { requireArtifactNames: true, requireExtraResources: true },
  );
}

async function checkPackageJson(
  repoRoot: string,
  relativePath: string,
  errors: string[],
  options: { requireArtifactNames?: boolean; requireExtraResources?: boolean } = {},
): Promise<void> {
  const value = await readJsonFile<Record<string, unknown>>(path.join(repoRoot, relativePath));
  if (!value) {
    errors.push(`${normalizeRelativePath(relativePath)} is missing or invalid JSON.`);
    return;
  }

  if (value['private'] !== true) {
    errors.push(`${normalizeRelativePath(relativePath)} must remain private until publication metadata is explicitly added.`);
  }
  if (value['license'] !== 'MIT') {
    errors.push(`${normalizeRelativePath(relativePath)} must declare "license": "MIT".`);
  }
  for (const forbidden of ['repository', 'homepage', 'bugs', 'publishConfig']) {
    if (Object.hasOwn(value, forbidden)) {
      errors.push(`${normalizeRelativePath(relativePath)} must not declare ${forbidden} before public URLs are chosen.`);
    }
  }

  if (relativePath === 'package.json') {
    const scripts = value['scripts'];
    if (!isRecord(scripts) || scripts['check-open-source-readiness'] !== 'tsx src/backend/platform/validation/cli.ts check-open-source-readiness') {
      errors.push('package.json must expose pnpm run check-open-source-readiness.');
    }
  }

  if (options.requireArtifactNames) {
    const build = value['build'];
    const artifactNames = collectArtifactNames(isRecord(build) ? build : {});
    if (artifactNames.length === 0) {
      errors.push(`${normalizeRelativePath(relativePath)} must declare release artifact names.`);
    }
    for (const artifactName of artifactNames) {
      if (!artifactName.startsWith('tasksail-')) {
        errors.push(`${normalizeRelativePath(relativePath)} artifactName must use tasksail branding: ${artifactName}`);
      }
      if (/custom-terminal-ui/iu.test(artifactName)) {
        errors.push(`${normalizeRelativePath(relativePath)} artifactName still contains old custom-terminal-ui branding.`);
      }
    }
  }

  if (options.requireExtraResources) {
    const extraResources = isRecord(value['build']) ? value['build']['extraResources'] : undefined;
    const encoded = JSON.stringify(extraResources ?? null);
    for (const required of ['LICENSE', 'THIRD_PARTY_LICENSES.md', 'OFL-Outfit.txt', 'OFL-SourceCodePro.txt', 'fonts-README.md']) {
      if (!encoded.includes(required)) {
        errors.push(`${normalizeRelativePath(relativePath)} build.extraResources must package ${required}.`);
      }
    }
  }
}

function collectArtifactNames(build: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const key of ['artifactName', 'mac', 'win', 'linux']) {
    const value = build[key];
    if (typeof value === 'string' && key === 'artifactName') {
      values.push(value);
    } else if (isRecord(value) && typeof value['artifactName'] === 'string') {
      values.push(value['artifactName']);
    }
  }
  return values;
}

async function checkThirdPartyNotice(repoRoot: string, errors: string[]): Promise<void> {
  const notice = await readRequiredText(repoRoot, 'THIRD_PARTY_LICENSES.md', errors);
  if (notice === null) return;
  for (const term of REQUIRED_THIRD_PARTY_TERMS) {
    if (!notice.includes(term)) {
      errors.push(`THIRD_PARTY_LICENSES.md must document ${term}.`);
    }
  }
}

async function checkAssetProvenance(
  repoRoot: string,
  trackedFiles: string[],
  errors: string[],
): Promise<void> {
  const fontAssets = trackedFiles.filter((file) => file.startsWith('src/frontend/desktop/src/assets/fonts/'));
  if (fontAssets.some((file) => file.endsWith('.woff2'))) {
    for (const required of [
      'src/frontend/desktop/src/assets/fonts/OFL-Outfit.txt',
      'src/frontend/desktop/src/assets/fonts/OFL-SourceCodePro.txt',
      'src/frontend/desktop/src/assets/fonts/README.md',
    ]) {
      if (!await fileExists(path.join(repoRoot, required))) {
        errors.push(`Bundled font asset requires provenance file: ${required}`);
      }
    }
  }

  const trackedIcons = trackedFiles.filter((file) => file.startsWith('src/frontend/desktop/build/'));
  for (const icon of trackedIcons) {
    if (!ALLOWED_TRACKED_BUILD_FILES.has(icon)) {
      errors.push(`Only documented desktop icons may be tracked under src/frontend/desktop/build: ${icon}`);
    }
  }
  if (trackedIcons.some((file) => file.endsWith('.png'))) {
    const sourceIcon = path.join(repoRoot, 'src', 'frontend', 'desktop', 'build', 'icon.svg');
    const notice = await readTextFile(path.join(repoRoot, 'THIRD_PARTY_LICENSES.md'));
    if (!await fileExists(sourceIcon) && !(notice ?? '').includes('icon')) {
      errors.push('Desktop icon PNGs require src/frontend/desktop/build/icon.svg or icon provenance in THIRD_PARTY_LICENSES.md.');
    }
  }
}

async function checkPnpmImporters(
  repoRoot: string,
  importers: string[],
  errors: string[],
): Promise<void> {
  const exceptions = await loadImporterExceptions(repoRoot, errors);
  for (const importer of importers) {
    const manifest = importer === '.'
      ? 'package.json'
      : `${importer}/package.json`;
    if (await fileExists(path.join(repoRoot, manifest))) {
      continue;
    }
    if (exceptions.has(importer)) {
      continue;
    }
    errors.push(`pnpm-lock.yaml importer has no package manifest or documented exception: ${importer}`);
  }
}

async function loadImporterExceptions(repoRoot: string, errors: string[]): Promise<Set<string>> {
  const value = await readJsonFile<ExceptionsFile>(path.join(repoRoot, EXCEPTIONS_PATH));
  if (!value) {
    errors.push(`${EXCEPTIONS_PATH} is missing or invalid JSON.`);
    return new Set();
  }

  const exceptions = new Set<string>();
  for (const entry of value.pnpmLockImporterExceptions ?? []) {
    if (!entry.importer || !entry.reason) {
      errors.push(`${EXCEPTIONS_PATH} contains an importer exception without an importer or reason.`);
      continue;
    }
    exceptions.add(normalizeRelativePath(entry.importer));
  }
  return exceptions;
}

function checkTrackedReleaseBoundary(trackedFiles: string[], errors: string[]): void {
  for (const relativePath of trackedFiles) {
    const segments = relativePath.split('/');
    const basename = path.posix.basename(relativePath);
    if (basename === '.DS_Store' || basename === 'Thumbs.db' || basename === 'desktop.ini') {
      errors.push(`Tracked OS metadata file is not release-safe: ${relativePath}`);
    }
    if (basename.endsWith('.pyc') || basename.endsWith('.tsbuildinfo') || basename.endsWith('.log')) {
      errors.push(`Tracked generated/runtime file is not release-safe: ${relativePath}`);
    }
    if (basename.startsWith('.env') && !isAllowedEnvExample(basename)) {
      errors.push(`Tracked env file is not release-safe: ${relativePath}`);
    }
    if (segments.includes('.platform-state')) {
      errors.push(`Tracked runtime state is not release-safe: ${relativePath}`);
    }
    if (segments.includes('node_modules')) {
      errors.push(`Tracked dependency directory is not release-safe: ${relativePath}`);
    }
    if (segments.includes('dist') || segments.includes('dist-electron') || segments.includes('release')) {
      errors.push(`Tracked generated build output is not release-safe: ${relativePath}`);
    }
    if (segments.includes('__pycache__')) {
      errors.push(`Tracked Python cache output is not release-safe: ${relativePath}`);
    }
    if (relativePath.startsWith('scratchspace/') && relativePath !== 'scratchspace/README.md') {
      errors.push(`Only scratchspace/README.md may be tracked for a public source release: ${relativePath}`);
    }
    if (relativePath.startsWith('contextpacks/') && relativePath !== 'contextpacks/.gitkeep') {
      errors.push(`Only contextpacks/.gitkeep may be tracked for a public source release: ${relativePath}`);
    }
    if (relativePath.startsWith('AgentWorkSpace/') && !isAllowedAgentWorkspacePath(relativePath)) {
      errors.push(`Only AgentWorkSpace templates and queue placeholders may be tracked: ${relativePath}`);
    }
    if (relativePath.startsWith('src/frontend/desktop/build/') && !ALLOWED_TRACKED_BUILD_FILES.has(relativePath)) {
      errors.push(`Only documented desktop icon assets may be tracked under src/frontend/desktop/build: ${relativePath}`);
    }
  }
}

function isAllowedAgentWorkspacePath(relativePath: string): boolean {
  if (relativePath.startsWith('AgentWorkSpace/templates/')) return true;
  return [
    'AgentWorkSpace/dropbox/.gitkeep',
    'AgentWorkSpace/dropbox/.staging/.gitkeep',
    'AgentWorkSpace/error-items/.gitkeep',
    'AgentWorkSpace/pendingitems/.gitkeep',
    'AgentWorkSpace/qmd/.gitkeep',
    'AgentWorkSpace/tasks/.gitkeep',
  ].includes(relativePath);
}

function isAllowedEnvExample(basename: string): boolean {
  return basename === '.env.example'
    || basename.endsWith('.example')
    || basename.endsWith('.sample')
    || basename.endsWith('.template');
}

function checkPersonalPathText(relativePath: string, content: string, errors: string[]): void {
  const patterns = [
    { name: 'macOS home path', pattern: /\/Users\/([A-Za-z0-9._-]+)\b/gu },
    { name: 'Linux home path', pattern: /\/home\/([A-Za-z0-9._-]+)\b/gu },
    { name: 'Windows user path', pattern: /[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)\b/gu },
    { name: 'WSL home path', pattern: /\/mnt\/[a-z]\/Users\/([A-Za-z0-9._-]+)\b/giu },
  ];
  for (const { name, pattern } of patterns) {
    for (const match of content.matchAll(pattern)) {
      const username = match[1]?.toLowerCase();
      if (username && ALLOWED_HOME_NAMES.has(username)) continue;
      errors.push(`${relativePath}:${lineNumberAt(content, match.index ?? 0)} contains a personal ${name}.`);
    }
  }
}

function checkSecretText(relativePath: string, content: string, errors: string[]): void {
  if (isSecretScanExempt(relativePath)) return;
  for (const { name, pattern } of HIGH_CONFIDENCE_SECRET_PATTERNS) {
    const match = pattern.exec(content);
    if (match) {
      errors.push(`${relativePath}:${lineNumberAt(content, match.index)} contains a high-confidence ${name}.`);
    }
    pattern.lastIndex = 0;
  }
}

function isSecretScanExempt(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return basename.endsWith('.lock')
    || relativePath === 'pnpm-lock.yaml'
    || relativePath.endsWith('/package-lock.json');
}

async function checkPackagedOutput(
  repoRoot: string,
  errors: string[],
  warnings: string[],
): Promise<number> {
  const releaseRoot = path.join(repoRoot, 'src', 'frontend', 'desktop', 'release');
  if (!await directoryExists(releaseRoot)) {
    warnings.push('Desktop release directory is absent; packaged-file boundary was checked through build metadata only.');
    return 0;
  }

  const files = await listFilesRecursive(releaseRoot);
  const relativeFiles = files.map((file) => normalizeRelativePath(path.relative(releaseRoot, file)));
  const basenames = new Set(relativeFiles.map((file) => path.posix.basename(file)));
  for (const required of REQUIRED_PACKAGED_LICENSE_FILES) {
    if (!basenames.has(required)) {
      errors.push(`Packaged desktop output is missing ${required}.`);
    }
  }

  for (const relativePath of relativeFiles) {
    const basename = path.posix.basename(relativePath);
    if (basename === '.DS_Store' || basename.endsWith('.map') || basename.endsWith('.log')) {
      errors.push(`Packaged desktop output contains a non-release file: ${relativePath}`);
    }
    if (basename.startsWith('.env') && !isAllowedEnvExample(basename)) {
      errors.push(`Packaged desktop output contains an env file: ${relativePath}`);
    }
    if (
      relativePath.includes('.platform-state/')
      || relativePath.includes('contextpacks/')
      || relativePath.includes('AgentWorkSpace/')
    ) {
      errors.push(`Packaged desktop output contains runtime workspace content: ${relativePath}`);
    }
  }
  return relativeFiles.length;
}

async function extractPnpmImporters(repoRoot: string, errors: string[]): Promise<string[]> {
  const lockfile = await readRequiredText(repoRoot, 'pnpm-lock.yaml', errors);
  if (lockfile === null) return [];

  const importers: string[] = [];
  const lines = lockfile.split(/\r?\n/u);
  let inImporters = false;
  for (const line of lines) {
    if (/^\S/u.test(line) && line.trim() === 'importers:') {
      inImporters = true;
      continue;
    }
    if (inImporters && /^\S/u.test(line)) {
      break;
    }
    if (!inImporters) continue;
    const match = line.match(/^ {2}([^ ].*):\s*$/u);
    if (match) {
      importers.push(normalizeRelativePath(unquoteYamlKey(match[1]!.trim())));
    }
  }
  return importers;
}

function unquoteYamlKey(value: string): string {
  if (
    (value.startsWith("'") && value.endsWith("'"))
    || (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function readRequiredText(
  repoRoot: string,
  relativePath: string,
  errors: string[],
): Promise<string | null> {
  const normalized = normalizeRelativePath(relativePath);
  const content = await readTextFile(path.join(repoRoot, normalized));
  if (content === null) {
    errors.push(`${normalized} is missing or unreadable.`);
  }
  return content;
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const content = await readTextFile(filePath);
  if (content === null) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function shouldScanText(relativePath: string): boolean {
  if (isSecretScanExempt(relativePath)) return false;
  if (relativePath.startsWith('src/frontend/desktop/release/')) return false;
  if (relativePath.startsWith('src/frontend/desktop/dist')) return false;
  if (relativePath.startsWith('.git/')) return false;
  const segments = relativePath.split('/');
  if (segments.some((segment) => GENERATED_PATH_SEGMENTS.has(segment))) {
    return false;
  }
  const ext = path.posix.extname(relativePath);
  return TEXT_EXTENSIONS.has(ext) || ext === '';
}

function isAssetPath(relativePath: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|ico|icns|svg|woff2?|ttf|otf)$/iu.test(relativePath);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/u).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
