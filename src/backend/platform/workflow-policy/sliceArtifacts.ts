/**
 * Shared slice-artifact helpers for XML and markdown execution slices.
 *
 * Markdown mode delegates to existing markdown parsing machinery.
 * XML mode parses the controlled fixed-template shape without new dependencies.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { SliceArtifactFormat } from '../platform-config/types.js';
import {
  parseSections,
  parseSemanticSections,
  resolveSemanticSection,
} from './artifacts.js';
import {
  SLICE_REQUIRED_SECTION_SPECS,
  type SemanticSectionSpec,
} from './models.js';
import { loadMarkdownContract } from './contracts/markdownContract.js';
import { normalizeText } from './matching.js';

export interface SliceArtifactDescriptor {
  format: SliceArtifactFormat;
  extension: '.md' | '.xml';
  templateFilename: 'slice-template.md' | 'slice-template.xml';
  filenamePattern: RegExp;
  displayGlob: 'slice-*.md' | 'slice-*.xml';
}

export interface SliceArtifactContent {
  sliceId: string;
  text: string;
  requiredFields: Record<string, string>;
  validationSurfaceText: string;
  validationCommandsText: string;
}

export function describeSliceArtifactFormat(format: SliceArtifactFormat): SliceArtifactDescriptor {
  if (format === 'xml') {
    return {
      format: 'xml',
      extension: '.xml',
      templateFilename: 'slice-template.xml',
      filenamePattern: /^slice-[1-9]\d*\.xml$/,
      displayGlob: 'slice-*.xml',
    };
  }
  return {
    format: 'markdown',
    extension: '.md',
    templateFilename: 'slice-template.md',
    filenamePattern: /^slice-[1-9]\d*\.md$/,
    displayGlob: 'slice-*.md',
  };
}

export async function listSliceArtifactFiles(
  stepsDir: string,
  format: SliceArtifactFormat,
): Promise<string[]> {
  try {
    const desc = describeSliceArtifactFormat(format);
    const entries = await readdir(stepsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && desc.filenamePattern.test(entry.name))
      .map((entry) => path.join(stepsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function listWrongFormatSliceFiles(
  stepsDir: string,
  format: SliceArtifactFormat,
): Promise<string[]> {
  try {
    const wrongExt = format === 'xml' ? '.md' : '.xml';
    const wrongPattern = format === 'xml'
      ? /^slice-[1-9]\d*\.md$/
      : /^slice-[1-9]\d*\.xml$/;
    const entries = await readdir(stepsDir, { withFileTypes: true });
    return entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (!entry.name.endsWith(wrongExt)) return false;
        if (entry.name === 'slice-template.md' || entry.name === 'slice-template.xml') return false;
        return wrongPattern.test(entry.name);
      })
      .map((entry) => path.join(stepsDir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function sliceIdFromFilename(filePath: string, format: SliceArtifactFormat): string {
  const base = path.basename(filePath);
  const ext = format === 'xml' ? '.xml' : '.md';
  if (base.endsWith(ext)) {
    return base.slice(0, -ext.length);
  }
  // fallback: strip any known extension
  return base.replace(/\.(md|xml)$/, '');
}

export function normalizeParallelSliceReference(
  value: string,
  format: SliceArtifactFormat,
): string {
  const trimmed = value.trim();
  if (format === 'xml') {
    // Accept bare slice ids or XML slice artifacts. Reject wrong-format markdown refs by
    // returning '' so callers (which drop falsy refs) do not silently treat it
    // as the matching slice-N.xml. Callers must gate their free-text fallback on
    // whether any raw reference existed, not on whether one survived filtering.
    if (/\.md$/i.test(trimmed)) {
      return '';
    }
    return trimmed.replace(/\.xml$/i, '');
  }
  return trimmed.replace(/\.md$/i, '');
}

const XML_REQUIRED_FIELD_PATHS: readonly string[] = [
  'metadata/title',
  'objective/purpose',
  'objective/inputsToRead',
  'dependenciesAndOrder/dependsOn',
  'executionScope/scope',
  'executionScope/currentSymbols',
  'executionScope/includedSymbols',
  'executionScope/excludedSymbols',
  'executionScope/requirementCoverage',
  'executionScope/allowedChanges',
  'executionScope/outOfScope',
  'executionScope/preservedBehavior',
  'implementation/requiredChanges',
  'filesAndInterfaces/files',
  'filesAndInterfaces/unitTests',
  'acceptanceAndValidation/acceptanceCriteria',
  'acceptanceAndValidation/validationCommands',
  'acceptanceAndValidation/staleAssumptionHandling',
  'guardsAndCoordination/guards',
  'guardsAndCoordination/coordination',
  'guardsAndCoordination/closeoutRequirements',
];

export const MARKDOWN_SCOPE_INVENTORY_SECTION_SPECS: readonly SemanticSectionSpec[] = [
  {
    key: 'current-symbols',
    preferredHeading: 'Current Symbols',
    aliases: ['Current Source Symbols', 'Source Inventory'],
    containerHeadings: ['Execution Scope', 'Scope'],
    allowContainerFallback: false,
  },
  {
    key: 'included-symbols',
    preferredHeading: 'Included Symbols',
    aliases: ['Included Source Symbols'],
    containerHeadings: ['Execution Scope', 'Scope'],
    allowContainerFallback: false,
  },
  {
    key: 'excluded-symbols',
    preferredHeading: 'Excluded Symbols',
    aliases: ['Excluded Source Symbols'],
    containerHeadings: ['Execution Scope', 'Scope'],
    allowContainerFallback: false,
  },
];

const XML_PLACEHOLDER_RE =
  /^(?:tbd|todo|tba|placeholder)\.?$/i;

function stripXmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function decodeCdata(text: string): string {
  return text
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Extract a named XML element's body from the fixed slice template.
 * Self-closing tags are intentionally outside this lightweight parser.
 */
function extractXmlElement(xml: string, elementName: string): string | null {
  const re = new RegExp(
    `<${elementName}(?:\\s[^>]*)?>([\\s\\S]*?)</${elementName}>`,
    '',
  );
  const match = re.exec(xml);
  if (!match) return null;
  const raw = match[1] ?? '';
  return decodeXmlEntities(decodeCdata(raw));
}

function extractXmlChildElement(
  xml: string,
  parentName: string,
  childName: string,
): string | null {
  const parentContent = extractXmlElement(xml, parentName);
  if (parentContent === null) return null;
  return extractXmlElement(parentContent, childName);
}

function extractXmlRequiredFields(xml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const fieldPath of XML_REQUIRED_FIELD_PATHS) {
    const [parent, child] = fieldPath.split('/') as [string, string];
    const content = extractXmlChildElement(xml, parent, child);
    if (content !== null) {
      result[fieldPath] = content;
    }
  }
  return result;
}

/**
 * Determine if a decoded field body is considered "incomplete":
 * - empty or whitespace-only
 * - placeholder-only (tbd/todo/tba/placeholder)
 * - comment-only (only XML comments remain after stripping)
 * - template-comment-only (one or more template guidance comments, nothing else)
 * - empty fenced-command-only (```) with no command content
 *
 * For validationCommands, we allow non-empty fenced blocks.
 */
function isXmlFieldIncomplete(fieldPath: string, body: string): boolean {
  const stripped = stripXmlComments(body).trim();

  if (!stripped) {
    return true;
  }

  if (XML_PLACEHOLDER_RE.test(stripped)) {
    return true;
  }

  const bodyTrimmed = body.trim();
  if (!bodyTrimmed) return true;

  const noComments = bodyTrimmed.replace(/<!--[\s\S]*?-->/g, '').trim();
  if (!noComments) {
    return true;
  }

  if (fieldPath === 'acceptanceAndValidation/validationCommands') {
    return isFencedCommandBodyEmpty(noComments);
  }

  return false;
}

/**
 * Returns true when the only non-whitespace content in the text is an empty
 * code fence (``` ... ```) with no actual command lines inside it.
 */
function isFencedCommandBodyEmpty(text: string): boolean {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let hasCommandContent = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!inFence) {
      if (/^```/.test(trimmed)) {
        inFence = true;
        continue;
      }
      if (trimmed) {
        hasCommandContent = true;
      }
      continue;
    }
    if (trimmed === '```' || /^```/.test(trimmed)) {
      inFence = false;
      continue;
    }
    if (trimmed && !trimmed.startsWith('#')) {
      hasCommandContent = true;
    }
  }
  return !hasCommandContent;
}

function extractCommandsFromFences(sectionContent: string): string[] {
  const contract = loadMarkdownContract();
  const commands: string[] = [];
  let activeFence: string | null = null;
  let pendingContinuation: string | null = null;

  const flushPending = (): void => {
    if (pendingContinuation?.trim()) {
      commands.push(pendingContinuation.trim());
    }
    pendingContinuation = null;
  };

  for (const rawLine of sectionContent.split(/\r?\n/)) {
    if (!activeFence) {
      const openMatch = contract.compiled.fenceOpen.exec(rawLine);
      if (openMatch?.[contract.groups.fenceMarker]) {
        activeFence = openMatch[contract.groups.fenceMarker]!;
      }
      continue;
    }

    if (rawLine.trim() === activeFence) {
      flushPending();
      activeFence = null;
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) continue;

    let fragment: string;
    let hasContinuation: boolean;
    const withoutContinuation = removeSingleContinuationBackslash(trimmed);
    if (withoutContinuation !== null) {
      hasContinuation = true;
      fragment = withoutContinuation;
    } else {
      hasContinuation = false;
      fragment = trimmed;
    }

    if (pendingContinuation !== null) {
      pendingContinuation = `${pendingContinuation} ${fragment}`.trim();
    } else {
      pendingContinuation = fragment;
    }

    if (!hasContinuation) {
      flushPending();
    }
  }

  return commands;
}

function removeSingleContinuationBackslash(value: string): string | null {
  let slashCount = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\\'; i--) {
    slashCount++;
  }
  return slashCount === 1 ? value.slice(0, -1).trimEnd() : null;
}

export function parseSliceArtifactContent(args: {
  filePath: string;
  text: string;
  format: SliceArtifactFormat;
}): SliceArtifactContent {
  const { filePath, text, format } = args;
  const sliceId = sliceIdFromFilename(filePath, format);

  if (format === 'xml') {
    return parseXmlSliceArtifactContent(sliceId, text);
  }

  return parseMarkdownSliceArtifactContent(sliceId, text);
}

function parseMarkdownSliceArtifactContent(sliceId: string, text: string): SliceArtifactContent {
  const sections = parseSemanticSections(text);

  const requiredFields: Record<string, string> = {};
  for (const spec of [...SLICE_REQUIRED_SECTION_SPECS, ...MARKDOWN_SCOPE_INVENTORY_SECTION_SPECS]) {
    const content = resolveSemanticSection(sections, spec).content;
    requiredFields[spec.key] = normalizeText(content);
  }

  const validationSurfaceSpecs = SLICE_REQUIRED_SECTION_SPECS.filter((s) =>
    s.key === 'unit-tests' || s.key === 'acceptance-criteria' || s.key === 'validation-commands',
  );
  const validationSurfaceLines = validationSurfaceSpecs.flatMap((spec) =>
    resolveSemanticSection(sections, spec).content,
  );
  const validationSurfaceText = validationSurfaceLines.join('\n');

  const validationCommandsSpec = SLICE_REQUIRED_SECTION_SPECS.find(
    (s) => s.key === 'validation-commands',
  )!;
  const validationCommandsText = resolveSemanticSection(sections, validationCommandsSpec)
    .content.join('\n').trim();

  return {
    sliceId,
    text,
    requiredFields,
    validationSurfaceText,
    validationCommandsText,
  };
}

function parseXmlSliceArtifactContent(sliceId: string, text: string): SliceArtifactContent {
  // Decode returned text while extracting fields from raw XML.
  const decoded = decodeXmlEntities(decodeCdata(text));

  const requiredFields = extractXmlRequiredFields(text);

  const acceptanceCriteria = requiredFields['acceptanceAndValidation/acceptanceCriteria'] ?? '';
  const validationCommandsText = requiredFields['acceptanceAndValidation/validationCommands'] ?? '';
  const validationSurfaceText = [acceptanceCriteria, validationCommandsText]
    .filter(Boolean)
    .join('\n');

  return {
    sliceId,
    text: decoded,
    requiredFields,
    validationSurfaceText,
    validationCommandsText,
  };
}

export function missingRequiredSliceFields(content: SliceArtifactContent): string[] {
  const missing: string[] = [];
  for (const fieldPath of XML_REQUIRED_FIELD_PATHS) {
    const body = content.requiredFields[fieldPath];
    if (body === undefined || isXmlFieldIncomplete(fieldPath, body)) {
      missing.push(fieldPath);
    }
  }
  return missing;
}

/**
 * Required leaf elements must carry the controlled template's required="true"
 * marker. Returns the field paths whose leaf element is present in the raw XML
 * but is missing required="true" (a fully absent element is already reported by
 * missingRequiredSliceFields via its body check, so it is skipped here to avoid
 * a duplicate reason). Child element names in XML_REQUIRED_FIELD_PATHS are
 * globally unique, so a direct open-tag scan is unambiguous; ambiguous duplicate
 * elements are rejected earlier by repairXmlSliceStructure.
 */
export function missingRequiredAttributeFields(rawXml: string): string[] {
  const missing: string[] = [];
  for (const fieldPath of XML_REQUIRED_FIELD_PATHS) {
    const childName = fieldPath.split('/')[1]!;
    const openTagMatch = new RegExp(`<${childName}((?:\\s[^>]*)?)>`).exec(rawXml);
    if (!openTagMatch) {
      continue;
    }
    if (!/\brequired="true"/.test(openTagMatch[1] ?? '')) {
      missing.push(fieldPath);
    }
  }
  return missing;
}

export function extractSliceValidationCommands(args: {
  text: string;
  format: SliceArtifactFormat;
}): string[] {
  const { text, format } = args;

  if (format === 'xml') {
    const validationCommandsBody = extractXmlChildElement(
      text,
      'acceptanceAndValidation',
      'validationCommands',
    );
    if (!validationCommandsBody) return [];
    const decoded = decodeXmlEntities(decodeCdata(validationCommandsBody));
    return extractCommandsFromFences(decoded);
  }

  const validationCommandsSpec = SLICE_REQUIRED_SECTION_SPECS.find(
    (s) => s.key === 'validation-commands',
  );
  if (!validationCommandsSpec) return [];
  const sections = parseSections(text);
  const sectionContent = resolveSemanticSection(sections, validationCommandsSpec)
    .content.join('\n').trim();
  if (!sectionContent) return [];
  return extractCommandsFromFences(sectionContent);
}

const EXECUTION_SLICE_OPEN_RE = /<executionSlice\b[^>]*>/;
const EXECUTION_SLICE_CLOSE_RE = /<\/executionSlice>/;

// Benign result reason: the slice is already well-formed and needed no repair.
// Callers must distinguish this from genuine non-repairable structural failures.
export const REPAIR_NO_STRUCTURAL_ISSUES_REASON = 'no structural issues found';

export function repairXmlSliceStructure(args: {
  filePath: string;
  text: string;
  expectedSliceId: string;
}): { repaired: boolean; text: string; reason: string | null } {
  const { filePath, text, expectedSliceId } = args;

  const noRepair = (reason: string): { repaired: boolean; text: string; reason: string | null } => ({
    repaired: false,
    text,
    reason,
  });

  if (filePath.endsWith('.md')) {
    return noRepair('repair does not apply to markdown files');
  }

  if (!EXECUTION_SLICE_OPEN_RE.test(text)) {
    return noRepair('text does not contain executionSlice element');
  }

  if (/^##\s/m.test(text)) {
    return noRepair('text appears to be a markdown document, not XML');
  }

  let result = text;
  let changed = false;

  // Duplicate required fields are ambiguous after XML comments are stripped.
  const strippedForDupCheck = stripXmlComments(text);
  for (const fieldPath of XML_REQUIRED_FIELD_PATHS) {
    const childName = fieldPath.split('/')[1]!;
    const tagPattern = new RegExp(`<${childName}(?:\\s[^>]*)?>`, 'g');
    const matches = strippedForDupCheck.match(tagPattern);
    if (matches && matches.length > 1) {
      return noRepair(`ambiguous: required field <${childName}> appears ${matches.length} times`);
    }
  }

  if (!result.startsWith('<?xml')) {
    result = `<?xml version="1.0" encoding="UTF-8"?>\n${result}`;
    changed = true;
  }

  const openTagMatch = EXECUTION_SLICE_OPEN_RE.exec(result);
  if (openTagMatch) {
    const openTag = openTagMatch[0];
    const hasId = /\bid="[^"]*"/.test(openTag);
    if (!hasId) {
      const fixedTag = openTag.replace('<executionSlice', `<executionSlice id="${expectedSliceId}"`);
      result = result.replace(openTag, fixedTag);
      changed = true;
    } else {
      const idMatch = /\bid="([^"]*)"/.exec(openTag);
      if (idMatch && idMatch[1] !== expectedSliceId) {
        const fixedTag = openTag.replace(/\bid="[^"]*"/, `id="${expectedSliceId}"`);
        result = result.replace(openTag, fixedTag);
        changed = true;
      }
    }
  }

  if (!EXECUTION_SLICE_CLOSE_RE.test(result)) {
    result = result.trimEnd() + '\n</executionSlice>\n';
    changed = true;
  }

  if (!changed) {
    return { repaired: false, text, reason: REPAIR_NO_STRUCTURAL_ISSUES_REASON };
  }

  return { repaired: true, text: result, reason: null };
}
