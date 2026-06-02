// Enterprise mirror redirection: resolution, redaction, and local config
// rendering for npm/pnpm and PyPI internal mirrors plus container base-image
// overrides.
//
// The resolver/renderer/redaction helpers are pure and side-effect-free.
// applyEnterpriseMirrors performs the local-config filesystem writes, and
// checkMirrorReachability / runEnterpriseMirrorsStep add the network preflight.

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { loadEnv, readTextFile, writeTextFileAtomic } from '../core/index.js';

// Allowed mirror/base-image keys. Only these keys are ever read from repo .env;
// every other .env key is ignored and no value is shell-evaluated.
export const ENTERPRISE_MIRROR_ENV_KEYS = [
  'NPM_CONFIG_REGISTRY',
  'npm_config_registry',
  'NPM_CONFIG_REPLACE_REGISTRY_HOST',
  'npm_config_replace_registry_host',
  'PIP_INDEX_URL',
  'TASKSAIL_NPM_REGISTRY',
  'TASKSAIL_NPM_AUTH_TOKEN',
  'TASKSAIL_PYPI_INDEX_URL',
  'TASKSAIL_PYTHON_BASE_IMAGE',
  'TASKSAIL_ALPINE_BASE_IMAGE',
] as const;

export type MirrorEnvKey = (typeof ENTERPRISE_MIRROR_ENV_KEYS)[number];

// Plain object (not a Map) so container-env construction can spread it.
export type MirrorEnv = Partial<Record<MirrorEnvKey, string>>;

export const DEFAULT_PYTHON_BASE_IMAGE = 'python:3.12-alpine';
export const DEFAULT_ALPINE_BASE_IMAGE = 'alpine:3.20';

const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';

const MANAGED_BLOCK_START = '# >>> tasksail enterprise mirrors >>>';
const MANAGED_BLOCK_END = '# <<< tasksail enterprise mirrors <<<';

// Single-quoted so ${...} is an inert literal, never a template interpolation.
// The contiguous text "_authToken=${TASKSAIL_NPM_AUTH_TOKEN}" is also the only
// form the no-raw-token contract permits in generated .npmrc output.
const NPM_AUTH_LINE_SUFFIX = ':_authToken=${TASKSAIL_NPM_AUTH_TOKEN}';

const USERINFO_RE = /(\/\/)[^/@\s]+@/g;
const TOKEN_QUERY_RE =
  /([?&][^=&\s]*(?:token|auth|key|secret|password|apikey|pwd)[^=&\s]*=)[^&\s]*/gi;
// Mask the value segment immediately after a credential-keyword path segment,
// e.g. /token/abcdef/ -> /token/***/. Conservative: only segments preceded by a
// credential keyword, so legitimate path segments are left intact.
const TOKEN_PATH_RE = /(\/(?:token|auth|key|secret|apikey|password|pwd)\/)[^/?#\s]+/gi;
// Strips URL userinfo (user:password@) while preserving the rest byte-for-byte.
const URL_USERINFO_STRIP_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i;

export interface MirrorValidationError {
  key: string;
  message: string;
  redactedValue: string;
}

export interface NpmMirrorConfig {
  // Sanitized: never carries URL-embedded credentials.
  registry?: string;
  replaceRegistryHost?: string;
  authTokenReferenced: boolean;
  registryHadCredentials: boolean;
}

export interface PypiMirrorConfig {
  // Sanitized: never carries URL-embedded credentials.
  indexUrl: string;
  indexHadCredentials: boolean;
}

export interface ResolvedMirrors {
  configured: boolean;
  npm?: NpmMirrorConfig;
  pypi?: PypiMirrorConfig;
  pythonBaseImage?: string;
  alpineBaseImage?: string;
  errors: MirrorValidationError[];
  warnings: string[];
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

function normalizeRegistry(registry: string): string {
  return registry.replace(/\/+$/, '').toLowerCase();
}

function isDefaultNpmRegistry(registry: string): boolean {
  return normalizeRegistry(registry) === PUBLIC_NPM_REGISTRY;
}

// Mask credentials in any URL-like string. Works on invalid URLs too, since it
// is regex-based and never depends on new URL succeeding.
export function redactUrl(raw: string): string {
  return raw
    .replace(USERINFO_RE, '$1***@')
    .replace(TOKEN_QUERY_RE, '$1***')
    .replace(TOKEN_PATH_RE, '$1***');
}

// Remove URL-embedded credentials (userinfo). Returns the sanitized URL and
// whether any credentials were present. Used to keep secrets out of generated
// files; the rest of the URL is preserved unchanged.
export function stripUrlCredentials(url: string): { sanitized: string; hadCredentials: boolean } {
  const sanitized = url.replace(URL_USERINFO_STRIP_RE, '$1');
  return { sanitized, hadCredentials: sanitized !== url };
}

// Remove configured secret values (e.g. a raw npm auth token) from a message.
export function redactSecrets(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

// Map-to-object conversion happens here and only here. processEnv wins over repo
// .env. fileEnv is the Map returned by loadEnv and is read with get(), never
// bracket-indexed.
export function mergeEnterpriseMirrorEnv(
  processEnv: NodeJS.ProcessEnv,
  fileEnv: Map<string, string>,
): MirrorEnv {
  const merged: MirrorEnv = {};
  for (const key of ENTERPRISE_MIRROR_ENV_KEYS) {
    const value = firstNonEmpty(processEnv[key], fileEnv.get(key));
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function parseUrlOrError(
  key: string,
  value: string,
  errors: MirrorValidationError[],
): URL | undefined {
  try {
    return new URL(value);
  } catch {
    errors.push({
      key,
      message: `Invalid URL for ${key}.`,
      redactedValue: redactUrl(value),
    });
    return undefined;
  }
}

function resolveReplaceRegistryHost(
  env: MirrorEnv,
  npmRegistry: string | undefined,
): string | undefined {
  const explicit = firstNonEmpty(
    env.NPM_CONFIG_REPLACE_REGISTRY_HOST,
    env.npm_config_replace_registry_host,
  );
  if (explicit) return explicit;
  // pnpm shorthand: only meaningful once a non-public registry is in force.
  if (npmRegistry && !isDefaultNpmRegistry(npmRegistry)) return 'npmjs';
  return undefined;
}

export function resolveEnterpriseMirrors(env: MirrorEnv): ResolvedMirrors {
  const errors: MirrorValidationError[] = [];
  const warnings: string[] = [];
  const result: ResolvedMirrors = { configured: false, errors, warnings };

  const npmRegistry = firstNonEmpty(
    env.NPM_CONFIG_REGISTRY,
    env.npm_config_registry,
    env.TASKSAIL_NPM_REGISTRY,
  );
  const authToken = firstNonEmpty(env.TASKSAIL_NPM_AUTH_TOKEN);

  if (npmRegistry) {
    const url = parseUrlOrError('npm registry', npmRegistry, errors);
    if (url) {
      // Sanitize immediately so no embedded credential is ever stored or returned.
      const { sanitized, hadCredentials } = stripUrlCredentials(npmRegistry);
      result.npm = {
        registry: sanitized,
        replaceRegistryHost: resolveReplaceRegistryHost(env, sanitized),
        authTokenReferenced: authToken !== undefined,
        registryHadCredentials: hadCredentials,
      };
    }
  } else if (authToken !== undefined) {
    warnings.push(
      'TASKSAIL_NPM_AUTH_TOKEN is set but no npm registry is configured; the auth reference was not rendered.',
    );
  }

  const pypiIndex = firstNonEmpty(env.PIP_INDEX_URL, env.TASKSAIL_PYPI_INDEX_URL);
  if (pypiIndex) {
    const url = parseUrlOrError('PyPI index', pypiIndex, errors);
    if (url) {
      const { sanitized, hadCredentials } = stripUrlCredentials(pypiIndex);
      result.pypi = { indexUrl: sanitized, indexHadCredentials: hadCredentials };
    }
  }

  result.pythonBaseImage = firstNonEmpty(env.TASKSAIL_PYTHON_BASE_IMAGE);
  result.alpineBaseImage = firstNonEmpty(env.TASKSAIL_ALPINE_BASE_IMAGE);

  result.configured = Boolean(
    result.npm || result.pypi || result.pythonBaseImage || result.alpineBaseImage,
  );
  return result;
}

function npmAuthScope(registry: string): string | undefined {
  try {
    const url = new URL(registry);
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return `//${url.host}${path}`;
  } catch {
    return undefined;
  }
}

// Inner lines of the managed .npmrc block (without markers).
export function renderNpmrcManagedLines(npm: NpmMirrorConfig): string[] {
  const lines: string[] = [];
  // Never persist URL-embedded credentials; auth flows through the token reference.
  const registry = npm.registry ? stripUrlCredentials(npm.registry).sanitized : undefined;
  if (registry) lines.push(`registry=${registry}`);
  if (npm.authTokenReferenced && registry) {
    const scope = npmAuthScope(registry);
    if (scope) lines.push(scope + NPM_AUTH_LINE_SUFFIX);
  }
  if (npm.replaceRegistryHost) {
    lines.push(`replace-registry-host=${npm.replaceRegistryHost}`);
  }
  return lines;
}

export function renderPipConfManagedLines(pypi: PypiMirrorConfig): string[] {
  // Defense in depth: the apply layer skips credential-bearing index URLs, but
  // strip userinfo here too so this pure renderer can never emit a secret.
  return ['[global]', `index-url = ${stripUrlCredentials(pypi.indexUrl).sanitized}`];
}

function buildManagedBlock(innerLines: string[]): string {
  return [MANAGED_BLOCK_START, ...innerLines, MANAGED_BLOCK_END].join('\n');
}

function stripManagedBlock(base: string, startIdx: number, endIdx: number): string {
  const before = base.slice(0, startIdx).replace(/\n+$/, '');
  const after = base.slice(endIdx + MANAGED_BLOCK_END.length).replace(/^\n+/, '');
  if (before === '' && after === '') return '';
  if (before === '') return after;
  if (after === '') return `${before}\n`;
  return `${before}\n${after}`;
}

// Insert/replace/remove the TaskSail managed block while preserving all
// operator-authored content. Passing null (or no inner lines) removes the block.
// Idempotent: re-applying the same inner lines yields byte-identical output.
export function mergeManagedBlock(
  existing: string | undefined,
  innerLines: string[] | null,
): string {
  const base = existing ?? '';
  const startIdx = base.indexOf(MANAGED_BLOCK_START);
  const endIdx = base.indexOf(MANAGED_BLOCK_END);
  const hasBlock = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (innerLines === null || innerLines.length === 0) {
    return hasBlock ? stripManagedBlock(base, startIdx, endIdx) : base;
  }

  const block = buildManagedBlock(innerLines);
  if (hasBlock) {
    const before = base.slice(0, startIdx);
    const after = base.slice(endIdx + MANAGED_BLOCK_END.length);
    return before + block + after;
  }
  if (base.trim() === '') return `${block}\n`;
  const sep = base.endsWith('\n') ? '\n' : '\n\n';
  return `${base}${sep}${block}\n`;
}

export function isTaskSailManaged(content: string | undefined): boolean {
  return content !== undefined && content.includes(MANAGED_BLOCK_START);
}

// Full generated content for an .npmrc file given existing content and resolved
// npm config (undefined npm removes the managed block).
export function renderNpmrcContent(
  existing: string | undefined,
  npm: NpmMirrorConfig | undefined,
): string {
  return mergeManagedBlock(existing, npm ? renderNpmrcManagedLines(npm) : null);
}

// Full pip.conf content given existing content and resolved PyPI config
// (undefined pypi removes the managed block).
export function renderPipConfContent(
  existing: string | undefined,
  pypi: PypiMirrorConfig | undefined,
): string {
  return mergeManagedBlock(existing, pypi ? renderPipConfManagedLines(pypi) : null);
}

// --- Section B: idempotent local config application -------------------------

// Generated runtime files (all git-ignored). Relative to repoRoot.
const NPMRC_TARGETS = ['.npmrc', 'src/frontend/desktop/.npmrc'] as const;
const PIP_CONF_TARGET = '.platform-state/pip.conf';

export interface ApplyEnterpriseMirrorsOptions {
  // Defaults to process.env. process.env wins over repo .env.
  processEnv?: NodeJS.ProcessEnv;
}

export interface ApplyEnterpriseMirrorsResult {
  status: 'configured' | 'skipped' | 'failed';
  changedFiles: string[];
  messages: string[];
  warnings: string[];
  errors: MirrorValidationError[];
  resolved: ResolvedMirrors;
}

// Write/update/remove one managed file. Returns true when the file changed.
// Re-applying identical config is a no-op (no rewrite). Removing config that
// empties a TaskSail-managed file deletes it; operator-authored content is never
// deleted.
async function applyManagedFile(
  repoRoot: string,
  relPath: string,
  innerLines: string[] | null,
): Promise<boolean> {
  const absPath = join(repoRoot, relPath);
  const existing = await readTextFile(absPath);
  const removing = innerLines === null || innerLines.length === 0;
  if (removing && !isTaskSailManaged(existing)) {
    // Nothing to remove and nothing to add — never touch operator-authored files.
    return false;
  }
  const merged = mergeManagedBlock(existing, innerLines);
  if (merged.trim() === '') {
    if (existing !== undefined && isTaskSailManaged(existing)) {
      await rm(absPath, { force: true });
      return true;
    }
    return false;
  }
  const next = merged.endsWith('\n') ? merged : `${merged}\n`;
  if (next === existing) return false;
  await writeTextFileAtomic(absPath, next);
  return true;
}

// Resolve mirrors from process.env + repo .env, then apply to the generated
// local helper files. loadEnv returns a Map; merge reads it with get(). Must be
// called after ensureEnvFile has run so repo .env exists.
export async function applyEnterpriseMirrors(
  repoRoot: string,
  options: ApplyEnterpriseMirrorsOptions = {},
): Promise<ApplyEnterpriseMirrorsResult> {
  const processEnv = options.processEnv ?? process.env;
  const fileEnv = await loadEnv(join(repoRoot, '.env'));
  const merged = mergeEnterpriseMirrorEnv(processEnv, fileEnv);
  const resolved = resolveEnterpriseMirrors(merged);

  const changedFiles: string[] = [];
  const messages: string[] = [];
  const warnings = [...resolved.warnings];

  // npm: the registry value is already sanitized at resolve time; warn when the
  // operator's configured URL had embedded credentials.
  if (resolved.npm?.registryHadCredentials) {
    warnings.push(
      'npm registry URL contained embedded credentials; they were not written to .npmrc. Authenticate with TASKSAIL_NPM_AUTH_TOKEN or shell-exported credentials.',
    );
  }
  const npmLines = resolved.npm ? renderNpmrcManagedLines(resolved.npm) : null;
  for (const target of NPMRC_TARGETS) {
    if (await applyManagedFile(repoRoot, target, npmLines)) changedFiles.push(target);
  }

  // PyPI: a credential-bearing index URL is never persisted to pip.conf. Skipping
  // (pipLines = null) also removes any stale TaskSail-managed pip.conf.
  let pipLines: string[] | null = null;
  let pipConfWritten = false;
  if (resolved.pypi) {
    if (resolved.pypi.indexHadCredentials) {
      warnings.push(
        `PyPI index URL contained embedded credentials; ${PIP_CONF_TARGET} was not written. Export PIP_INDEX_URL in your shell so pip reads it directly (credentials are never persisted).`,
      );
    } else {
      pipLines = renderPipConfManagedLines(resolved.pypi);
      pipConfWritten = true;
    }
  }
  if (await applyManagedFile(repoRoot, PIP_CONF_TARGET, pipLines)) {
    changedFiles.push(PIP_CONF_TARGET);
  }

  if (resolved.npm?.registry) {
    messages.push(`npm registry mirror configured: ${redactUrl(resolved.npm.registry)}`);
  }
  if (pipConfWritten && resolved.pypi) {
    messages.push(
      `PyPI helper config written to ${PIP_CONF_TARGET} (set PIP_CONFIG_FILE to use it): ${redactUrl(resolved.pypi.indexUrl)}`,
    );
  }
  for (const err of resolved.errors) {
    messages.push(`${err.message} (${err.redactedValue})`);
  }

  const rawToken = merged.TASKSAIL_NPM_AUTH_TOKEN;
  const redactedMessages = messages.map((m) => redactSecrets(m, [rawToken]));
  const redactedWarnings = warnings.map((w) => redactSecrets(w, [rawToken]));

  const status: ApplyEnterpriseMirrorsResult['status'] =
    resolved.errors.length > 0 ? 'failed' : resolved.configured ? 'configured' : 'skipped';

  return {
    status,
    changedFiles,
    messages: redactedMessages,
    warnings: redactedWarnings,
    errors: resolved.errors,
    resolved,
  };
}

// --- Section C: setup integration and reachability preflight ----------------

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 2000;

export interface MirrorPreflightResult {
  url: string; // redacted
  reachable: boolean;
  status?: number;
  error?: string; // redacted
}

export interface PreflightOptions {
  // Injectable for tests so unit tests never require live network access.
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// Reachability probe. Any HTTP response (including 401/403) counts as reachable;
// only invalid URL, DNS/connect/TLS, and timeout failures are treated as
// unreachable. The result never carries raw credentials.
export async function checkMirrorReachability(
  rawUrl: string,
  options: PreflightOptions = {},
): Promise<MirrorPreflightResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
  const redacted = redactUrl(rawUrl);

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: redacted, reachable: false, error: 'invalid URL' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(parsed, { method: 'HEAD', signal: controller.signal });
    } catch {
      // Some mirrors reject HEAD outright; fall back to GET before giving up.
      response = await fetchImpl(parsed, { method: 'GET', signal: controller.signal });
    }
    return { url: redacted, reachable: true, status: response.status };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return { url: redacted, reachable: false, error: redactUrl(raw) };
  } finally {
    clearTimeout(timer);
  }
}

export interface EnterpriseMirrorsStepOptions {
  processEnv?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  skipPreflight?: boolean;
}

export interface SetupStepResult {
  name: string;
  status: 'ok' | 'skipped' | 'failed';
  message?: string;
}

export const ENTERPRISE_MIRRORS_STEP_NAME = 'enterprise-mirrors';

// Setup step: apply mirror config, then optionally preflight configured URLs.
// skipped → no mirror env vars; ok → applied and reachable (or nothing to
// probe); failed → invalid config or a configured mirror is unreachable.
export async function runEnterpriseMirrorsStep(
  repoRoot: string,
  options: EnterpriseMirrorsStepOptions = {},
): Promise<SetupStepResult> {
  const name = ENTERPRISE_MIRRORS_STEP_NAME;
  const applied = await applyEnterpriseMirrors(repoRoot, { processEnv: options.processEnv });

  if (applied.status === 'skipped') {
    return { name, status: 'skipped' };
  }
  if (applied.status === 'failed') {
    return { name, status: 'failed', message: applied.messages.join('; ') || 'invalid mirror config' };
  }

  const messages = [...applied.messages, ...applied.warnings];

  if (!options.skipPreflight) {
    const urls: string[] = [];
    if (applied.resolved.npm?.registry) urls.push(applied.resolved.npm.registry);
    if (applied.resolved.pypi?.indexUrl) urls.push(applied.resolved.pypi.indexUrl);

    for (const url of urls) {
      const preflight = await checkMirrorReachability(url, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      });
      if (!preflight.reachable) {
        return {
          name,
          status: 'failed',
          message: `mirror unreachable: ${preflight.url}${preflight.error ? ` (${preflight.error})` : ''}`,
        };
      }
      messages.push(`reachable: ${preflight.url}${preflight.status ? ` (HTTP ${preflight.status})` : ''}`);
    }
  }

  return { name, status: 'ok', message: messages.join('; ') || undefined };
}
