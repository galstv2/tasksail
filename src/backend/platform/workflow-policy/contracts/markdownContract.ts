import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECTION_NAMES = [
  'TASK_LINEAGE',
  'TASK_METADATA',
  'CONTEXT_PACK_BINDING',
  'REVIEW_OUTCOME',
  'DECISION',
  'DIFFICULTY_LEVEL',
  'RECOMMENDED_EXECUTION',
  'CLOSEOUT_OWNER_AGENT_ID',
  'RETROSPECTIVE_REQUIRED',
] as const;

const REQUIRED_GROUPS = [
  'headingName',
  'labelName',
  'labelValue',
  'title',
  'fenceMarker',
  'fenceLanguage',
] as const;

export type SectionNameKey = typeof REQUIRED_SECTION_NAMES[number];

export interface MarkdownContract {
  version: 1;
  headingRegex: string;
  labelRegex: string;
  titleRegex: string;
  fenceOpenRegex: string;
  groups: Readonly<Record<typeof REQUIRED_GROUPS[number], number>>;
  stripHtmlComments: boolean;
  warnOnDuplicateLabel: boolean;
  opaqueFences: boolean;
  sectionNames: Readonly<Record<SectionNameKey, string>>;
  compiled: Readonly<{
    heading: RegExp;
    label: RegExp;
    title: RegExp;
    fenceOpen: RegExp;
  }>;
}

let cachedContract: MarkdownContract | null = null;
let cachedDefaultPath: string | null = null;

function getDefaultContractPath(): string {
  cachedDefaultPath ??= resolveMarkdownContractPath();
  return cachedDefaultPath;
}

export function resolveMarkdownContractPath(repoRoot = process.cwd()): string {
  let current = path.resolve(repoRoot);
  while (true) {
    const candidate = path.join(current, 'config', 'markdown-contract.default.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      const moduleRelative = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../../config/markdown-contract.default.json',
      );
      return existsSync(moduleRelative)
        ? moduleRelative
        : path.join(path.resolve(repoRoot), 'config', 'markdown-contract.default.json');
    }
    current = parent;
  }
}

export function loadMarkdownContract(contractPath = getDefaultContractPath()): MarkdownContract {
  if (cachedContract && contractPath === getDefaultContractPath()) {
    return cachedContract;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(contractPath, 'utf-8'));
  } catch (err) {
    throw new Error(`${contractPath}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const record = requireRecord(raw, contractPath, '<root>');
  requireField(record.version === 1, contractPath, 'version');
  const headingRegex = requireString(record.headingRegex, contractPath, 'headingRegex');
  const labelRegex = requireString(record.labelRegex, contractPath, 'labelRegex');
  const titleRegex = requireString(record.titleRegex, contractPath, 'titleRegex');
  const fenceOpenRegex = requireString(record.fenceOpenRegex, contractPath, 'fenceOpenRegex');
  const groupsRecord = requireRecord(record.groups, contractPath, 'groups');
  const groups = Object.fromEntries(REQUIRED_GROUPS.map((key) => {
    const value = groupsRecord[key];
    requireField(Number.isInteger(value) && (value as number) > 0, contractPath, `groups.${key}`);
    return [key, value as number];
  })) as Record<typeof REQUIRED_GROUPS[number], number>;

  const sectionNameRecord = requireRecord(record.sectionNames, contractPath, 'sectionNames');
  const sectionNames = Object.fromEntries(REQUIRED_SECTION_NAMES.map((key) => {
    const value = requireString(sectionNameRecord[key], contractPath, `sectionNames.${key}`);
    return [key, value];
  })) as Record<SectionNameKey, string>;

  const compiled = {
    heading: compileRegex(headingRegex, contractPath, 'headingRegex', 'm'),
    label: compileRegex(labelRegex, contractPath, 'labelRegex', 'm'),
    title: compileRegex(titleRegex, contractPath, 'titleRegex', 'm'),
    fenceOpen: compileRegex(fenceOpenRegex, contractPath, 'fenceOpenRegex'),
  };

  smokeTest(contractPath, compiled, groups);

  const contract: MarkdownContract = Object.freeze({
    version: 1,
    headingRegex,
    labelRegex,
    titleRegex,
    fenceOpenRegex,
    groups: Object.freeze(groups),
    stripHtmlComments: record.stripHtmlComments === true,
    warnOnDuplicateLabel: record.warnOnDuplicateLabel === true,
    opaqueFences: record.opaqueFences === true,
    sectionNames: Object.freeze(sectionNames),
    compiled: Object.freeze(compiled),
  });

  if (contractPath === getDefaultContractPath()) {
    cachedContract = contract;
  }
  return contract;
}

export function validateMarkdownContract(contractPath = getDefaultContractPath()): void {
  loadMarkdownContract(contractPath);
}

function requireRecord(value: unknown, contractPath: string, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${contractPath}: invalid ${field}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, contractPath: string, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`${contractPath}: invalid ${field}`);
  }
  return value;
}

function requireField(condition: boolean, contractPath: string, field: string): void {
  if (!condition) {
    throw new Error(`${contractPath}: invalid ${field}`);
  }
}

function compileRegex(source: string, contractPath: string, field: string, flags = ''): RegExp {
  try {
    return new RegExp(source, flags);
  } catch (err) {
    throw new Error(`${contractPath}: invalid ${field}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function smokeTest(
  contractPath: string,
  compiled: MarkdownContract['compiled'],
  groups: MarkdownContract['groups'],
): void {
  if (compiled.heading.exec('##\tTask Lineage ##')?.[groups.headingName] !== 'Task Lineage') {
    throw new Error(`${contractPath}: invalid headingRegex embedded smoke fixture`);
  }
  const labelMatch = compiled.label.exec('- Difficulty Level: Hard <!-- bumped -->');
  if (labelMatch?.[groups.labelName] !== 'Difficulty Level' || labelMatch?.[groups.labelValue] !== 'Hard <!-- bumped -->') {
    throw new Error(`${contractPath}: invalid labelRegex embedded smoke fixture`);
  }
  if (compiled.title.exec('# Task Title ##')?.[groups.title] !== 'Task Title') {
    throw new Error(`${contractPath}: invalid titleRegex embedded smoke fixture`);
  }
  const fenceMatch = compiled.fenceOpen.exec('```bash ');
  if (fenceMatch?.[groups.fenceMarker] !== '```' || fenceMatch?.[groups.fenceLanguage] !== 'bash') {
    throw new Error(`${contractPath}: invalid fenceOpenRegex embedded smoke fixture`);
  }
}
