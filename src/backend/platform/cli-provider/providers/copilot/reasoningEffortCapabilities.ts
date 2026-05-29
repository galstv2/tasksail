import { execFile } from 'node:child_process';
import path from 'node:path';

import { createLogger } from '../../../core/logger.js';
import { isRecord } from '../../../core/guards.js';
import { readTextFile, writeTextFileAtomic } from '../../../core/io.js';
import { orderProviderReasoningEffortChoices } from '../../reasoningEffort.js';
import type { ProviderReasoningEffortCapabilities } from '../../types.js';

const log = createLogger('platform/copilot/reasoningEffortCapabilities');

const CACHE_SCHEMA_VERSION = 1;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CACHE_RELATIVE_PATH = path.join('.platform-state', 'copilot-cli-capabilities.json');
const EFFORT_FLAG_HELP_TOKENS = ['--effort', '--reasoning-effort'];
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu;

type CopilotCliCapabilitiesCache = {
  schema_version: 1;
  provider_id: 'copilot';
  cli_version: string;
  captured_at: string;
  reasoning_effort_choices: string[];
};

type CapabilityDiscoveryErrorCode = NonNullable<ProviderReasoningEffortCapabilities['errorCode']>;

type CapabilityDiscoveryError = Error & {
  code?: CapabilityDiscoveryErrorCode;
};

const pendingByRepoRoot = new Map<string, Promise<ProviderReasoningEffortCapabilities>>();

function cachePath(repoRoot: string): string {
  return path.join(repoRoot, CACHE_RELATIVE_PATH);
}

function orderCopilotAdvertisedChoices(choices: readonly string[]): string[] {
  const normalized = choices
    .map((choice) => choice.trim().toLowerCase())
    .filter(Boolean);
  return [
    ...(normalized.includes('none') ? ['none'] : []),
    ...orderProviderReasoningEffortChoices(normalized),
  ];
}

function parseCache(raw: string | undefined): CopilotCliCapabilitiesCache | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) ||
      parsed.schema_version !== CACHE_SCHEMA_VERSION ||
      parsed.provider_id !== 'copilot' ||
      typeof parsed.cli_version !== 'string' ||
      typeof parsed.captured_at !== 'string' ||
      !Array.isArray(parsed.reasoning_effort_choices)) {
      return null;
    }
    const choices = orderCopilotAdvertisedChoices(
      parsed.reasoning_effort_choices.filter((choice): choice is string => typeof choice === 'string'),
    );
    if (choices.length === 0) {
      return null;
    }
    return {
      schema_version: CACHE_SCHEMA_VERSION,
      provider_id: 'copilot',
      cli_version: parsed.cli_version,
      captured_at: parsed.captured_at,
      reasoning_effort_choices: choices,
    };
  } catch {
    return null;
  }
}

function isFresh(cache: CopilotCliCapabilitiesCache): boolean {
  const capturedAt = Date.parse(cache.captured_at);
  return Number.isFinite(capturedAt) && Date.now() - capturedAt < CACHE_MAX_AGE_MS;
}

function fromCache(cache: CopilotCliCapabilitiesCache, stale: boolean): ProviderReasoningEffortCapabilities {
  return {
    providerId: 'copilot',
    cliVersion: cache.cli_version,
    effortChoices: cache.reasoning_effort_choices,
    source: 'cache',
    stale,
  };
}

async function runCopilotCli(args: readonly string[]): Promise<string> {
  const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile('copilot', [...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
  return `${stdout ?? ''}${stderr ?? ''}`.trim();
}

function normalizeHelpText(helpText: string): string {
  return helpText
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'");
}

function isOptionStart(line: string): boolean {
  return /^\s{0,8}(?:-[A-Za-z0-9],\s*)?--?[A-Za-z0-9][A-Za-z0-9-]*/u.test(line);
}

function collectOptionParagraph(lines: readonly string[], startIndex: number): string {
  const paragraph: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (index > startIndex && (line.trim() === '' || isOptionStart(line))) {
      break;
    }
    paragraph.push(line);
  }
  return paragraph.join(' ');
}

function tokenizeChoiceSource(source: string): string[] {
  return Array.from(source.matchAll(/[a-z][a-z0-9-]*/giu), (match) => match[0].toLowerCase());
}

function extractChoicesFromParagraph(paragraph: string): string[] {
  const sources: string[] = [];
  for (const match of paragraph.matchAll(/\{([^}]+)\}/gu)) sources.push(match[1] ?? '');
  for (const match of paragraph.matchAll(/\[([^\]]+)\]/gu)) sources.push(match[1] ?? '');
  for (const match of paragraph.matchAll(/(?:choices?|allowed values?|one of)\s*[:=]\s*([a-z0-9,\s|"'-]+)(?:[).]|$)/giu)) {
    sources.push(match[1] ?? '');
  }
  return sources.flatMap(tokenizeChoiceSource);
}

function sliceFromEffortFlag(paragraph: string): string {
  const lower = paragraph.toLowerCase();
  const indexes = EFFORT_FLAG_HELP_TOKENS
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? paragraph.slice(Math.min(...indexes)) : paragraph;
}

export function parseCopilotReasoningEffortChoices(helpText: string): string[] {
  const choices = new Set<string>();
  const lines = normalizeHelpText(helpText).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!EFFORT_FLAG_HELP_TOKENS.some((token) => line.toLowerCase().includes(token))) {
      continue;
    }
    for (const choice of extractChoicesFromParagraph(sliceFromEffortFlag(collectOptionParagraph(lines, index)))) {
      choices.add(choice);
    }
  }
  return orderCopilotAdvertisedChoices([...choices]);
}

function hasReasoningEffortFlag(helpText: string): boolean {
  const normalized = normalizeHelpText(helpText).toLowerCase();
  return EFFORT_FLAG_HELP_TOKENS.some((token) => normalized.includes(token));
}

function capabilityError(message: string, code: CapabilityDiscoveryErrorCode): CapabilityDiscoveryError {
  const error = new Error(message) as CapabilityDiscoveryError;
  error.code = code;
  return error;
}

function capabilityErrorCode(err: unknown): CapabilityDiscoveryErrorCode {
  return isRecord(err) && typeof err.code === 'string' && (
    err.code === 'effort-flag-missing' ||
    err.code === 'choices-unparseable' ||
    err.code === 'probe-failed'
  )
    ? err.code
    : 'probe-failed';
}

async function probeCapabilities(repoRoot: string): Promise<ProviderReasoningEffortCapabilities> {
  const [cliVersion, helpText] = await Promise.all([
    runCopilotCli(['--version']),
    runCopilotCli(['--help']),
  ]);
  const effortChoices = parseCopilotReasoningEffortChoices(helpText);
  if (effortChoices.length === 0) {
    throw hasReasoningEffortFlag(helpText)
      ? capabilityError('Copilot help advertised reasoning effort but choices could not be parsed.', 'choices-unparseable')
      : capabilityError('Copilot help did not advertise reasoning effort.', 'effort-flag-missing');
  }

  const cache: CopilotCliCapabilitiesCache = {
    schema_version: CACHE_SCHEMA_VERSION,
    provider_id: 'copilot',
    cli_version: cliVersion,
    captured_at: new Date().toISOString(),
    reasoning_effort_choices: effortChoices,
  };
  await writeTextFileAtomic(cachePath(repoRoot), JSON.stringify(cache, null, 2) + '\n');
  log.info('provider.copilot.capabilities.refreshed', {
    providerId: 'copilot',
    cacheSource: 'probe',
  });
  return {
    providerId: 'copilot',
    cliVersion,
    effortChoices,
    source: 'probe',
    stale: false,
  };
}

async function loadCapabilities(repoRoot: string): Promise<ProviderReasoningEffortCapabilities> {
  const existingCache = parseCache(await readTextFile(cachePath(repoRoot)));
  if (existingCache && isFresh(existingCache)) {
    log.info('provider.copilot.capabilities.loaded', {
      providerId: 'copilot',
      cacheSource: 'cache',
    });
    return fromCache(existingCache, false);
  }

  try {
    return await probeCapabilities(repoRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCode = capabilityErrorCode(err);
    log.warn('provider.copilot.capabilities.failed', {
      providerId: 'copilot',
      cacheSource: existingCache ? 'cache' : 'unavailable',
      errorCode,
    });
    if (existingCache) {
      return {
        ...fromCache(existingCache, true),
        error: message,
        errorCode,
      };
    }
    return {
      providerId: 'copilot',
      cliVersion: null,
      effortChoices: [],
      source: 'unavailable',
      stale: true,
      error: message,
      errorCode,
    };
  }
}

export function getCopilotReasoningEffortCapabilities(
  repoRoot: string,
): Promise<ProviderReasoningEffortCapabilities> {
  const key = path.resolve(repoRoot);
  const pending = pendingByRepoRoot.get(key);
  if (pending) {
    return pending;
  }
  const next = loadCapabilities(key).finally(() => {
    pendingByRepoRoot.delete(key);
  });
  pendingByRepoRoot.set(key, next);
  return next;
}
