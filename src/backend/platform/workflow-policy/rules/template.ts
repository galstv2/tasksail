/**
 * Template structure validation rules for handoff artifacts.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_template.py
 */

import path from 'node:path';
import { readTextFile, safeJsonParse } from '../../core/index.js';
import { METADATA_LINE } from '../models.js';
import type { PolicyValidator } from '../validator.js';
import {
  ALLOWED_TASK_KINDS,
  HANDOFF_METADATA_LABELS,
  HANDOFF_TEMPLATE_SPECS,
  JSON_HANDOFF_TEMPLATE_SPECS,
  LINEAGE_HANDOFFS,
  LINEAGE_METADATA_LABELS,
  SLICE_TEMPLATE_RELATIVE_PATH,
  SLICE_TEMPLATE_SPEC,
  TEMPLATE_SOURCE_PATHS,
  type HandoffSpec,
  type JsonHandoffSpec,
} from './templateSpecs.js';

const HEADING_PATTERN = /^(#{1,6})\s+(.*\S)\s*$/;

// Template source paths that correspond to lineage-containing handoffs.
function buildLineageTemplateSources(): Set<string> {
  const sources = new Set<string>();
  for (const handoffPath of LINEAGE_HANDOFFS) {
    const srcPath = TEMPLATE_SOURCE_PATHS[handoffPath];
    if (srcPath) {
      sources.add(srcPath);
    }
  }
  return sources;
}

const LINEAGE_TEMPLATE_SOURCES = buildLineageTemplateSources();

function extractHeadings(
  lines: string[],
): Array<{ lineNumber: number; level: number; title: string }> {
  const headings: Array<{ lineNumber: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = HEADING_PATTERN.exec((lines[i] ?? '').trim());
    if (match) {
      headings.push({
        lineNumber: i + 1,
        level: (match[1] ?? '').length,
        title: match[2] ?? '',
      });
    }
  }
  return headings;
}

function extractSectionLines(lines: string[], sectionTitle: string): string[] {
  const sectionLines: string[] = [];
  let inSection = false;
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped === `## ${sectionTitle}`) {
      inSection = true;
      continue;
    }
    if (inSection && stripped.startsWith('## ')) {
      break;
    }
    if (inSection) {
      sectionLines.push(line.replace(/\n$/, ''));
    }
  }
  return sectionLines;
}

function extractNestedSectionLines(lines: string[], parentTitle: string, nestedTitle: string): string[] {
  const parentLines = extractSectionLines(lines, parentTitle);
  const headings = extractHeadings(parentLines);
  const nestedHeading = headings.find((heading) => heading.title === nestedTitle);
  if (!nestedHeading) {
    return [];
  }

  const nestedLines: string[] = [];
  let inNestedSection = false;
  for (const line of parentLines) {
    const trimmed = line.trim();
    const match = HEADING_PATTERN.exec(trimmed);
    if (match) {
      const level = (match[1] ?? '').length;
      const title = match[2] ?? '';
      if (!inNestedSection && title === nestedTitle) {
        inNestedSection = true;
        continue;
      }
      if (inNestedSection && level <= nestedHeading.level) {
        break;
      }
    }
    if (inNestedSection) {
      nestedLines.push(line.replace(/\n$/, ''));
    }
  }
  return nestedLines;
}

function extractMetadataLabels(lines: string[]): string[] {
  return lines
    .map((entry) => {
      const match = METADATA_LINE.exec(entry.trim());
      return match ? (match[1] ?? '').trim() : null;
    })
    .filter((label): label is string => label !== null);
}

async function validateTemplateSourcesPresent(validator: PolicyValidator): Promise<void> {
  for (const [handoffPath, sourcePath] of Object.entries(TEMPLATE_SOURCE_PATHS)) {
    const absolutePath = path.join(validator.rootDir, sourcePath);
    const text = await readTextFile(absolutePath);
    if (text === undefined) {
      validator.addViolation({
        rule_id: 'template.source-present',
        artifact: sourcePath,
        message: `Template source file missing for ${handoffPath}.`,
        remediation: `Create ${sourcePath} matching the canonical reset-state structure.`,
      });
    }
  }
}

export async function evaluateTemplateStructureRules(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('template.h1-title');
  validator.recordRule('template.required-sections-ordered');
  validator.recordRule('template.metadata-labels');
  validator.recordRule('template.lineage-labels');
  validator.recordRule('template.task-kind-enum');
  validator.recordRule('template.json-schema');
  validator.recordRule('template.source-present');

  if (validator.mode !== 'ci' && validator.mode !== 'lint') {
    return;
  }

  await validateTemplateSourcesPresent(validator);

  for (const [relativePath, spec] of Object.entries(HANDOFF_TEMPLATE_SPECS)) {
    const sourcePath = TEMPLATE_SOURCE_PATHS[relativePath];
    const validatePath = sourcePath ?? relativePath;
    await validateMdTemplate(validator, validatePath, spec);
  }

  const sliceTemplateSrc =
    TEMPLATE_SOURCE_PATHS[SLICE_TEMPLATE_RELATIVE_PATH] ?? SLICE_TEMPLATE_RELATIVE_PATH;
  await validateMdTemplate(validator, sliceTemplateSrc, SLICE_TEMPLATE_SPEC, {
    checkMetadata: false,
    checkLineage: false,
  });

  for (const [relativePath, spec] of Object.entries(JSON_HANDOFF_TEMPLATE_SPECS)) {
    const sourcePath = TEMPLATE_SOURCE_PATHS[relativePath];
    const validatePath = sourcePath ?? relativePath;
    await validateJsonTemplate(validator, validatePath, spec);
  }
}

async function validateMdTemplate(
  validator: PolicyValidator,
  relativePath: string,
  spec: HandoffSpec,
  options: { checkMetadata?: boolean; checkLineage?: boolean } = {},
): Promise<void> {
  const checkMetadata = options.checkMetadata ?? true;
  const checkLineage = options.checkLineage ?? true;

  const absolutePath = path.join(validator.rootDir, relativePath);
  const text = await readTextFile(absolutePath);
  if (text === undefined) {
    return;
  }

  const lines = text.split('\n');
  const headings = extractHeadings(lines);

  if (!headings.length) {
    validator.addViolation({
      rule_id: 'template.h1-title',
      artifact: relativePath,
      message: `No markdown headings found in ${relativePath}.`,
      remediation: `Add '# ${spec.title}' as the first heading.`,
    });
    return;
  }

  const { lineNumber, level, title } = headings[0]!;
  if (level !== 1 || title !== spec.title) {
    validator.addViolation({
      rule_id: 'template.h1-title',
      artifact: relativePath,
      message: `Expected H1 '# ${spec.title}' but found level-${level} heading '${title}' at line ${lineNumber}.`,
      remediation: `Set the first heading to '# ${spec.title}'.`,
    });
  }

  const observedH2 = headings.filter((h) => h.level === 2).map((h) => h.title);
  let cursor = 0;
  for (const section of spec.sections) {
    const idx = observedH2.indexOf(section, cursor);
    if (idx < 0) {
      validator.addViolation({
        rule_id: 'template.required-sections-ordered',
        artifact: relativePath,
        message: `Missing required H2 section '${section}'.`,
        remediation: `Add '## ${section}' to ${relativePath} in the documented order.`,
      });
    } else {
      cursor = idx + 1;
    }
  }

  if (checkMetadata && spec.sections.includes('Task Metadata')) {
    const extraLabels = spec.extra_metadata_labels ?? [];
    validateMetadataBlock(validator, relativePath, lines, [...extraLabels]);
  }

  if (
    checkLineage &&
    (LINEAGE_HANDOFFS.has(relativePath) || LINEAGE_TEMPLATE_SOURCES.has(relativePath))
  ) {
    validateLineageBlock(validator, relativePath, lines);
  }
}

function validateMetadataBlock(
  validator: PolicyValidator,
  relativePath: string,
  lines: string[],
  extraLabels: string[],
): void {
  const sectionLines = extractNestedSectionLines(lines, 'Task Metadata', 'Core Metadata');
  const fallbackSectionLines = sectionLines.length > 0 ? sectionLines : extractSectionLines(lines, 'Task Metadata');
  const contentLines = fallbackSectionLines.filter((l) => l.trim());
  const observed = extractMetadataLabels(contentLines);
  const expected = [...HANDOFF_METADATA_LABELS, ...extraLabels];
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    validator.addViolation({
      rule_id: 'template.metadata-labels',
      artifact: relativePath,
      message: `Metadata labels must be ${JSON.stringify(expected)}, found ${JSON.stringify(observed)}.`,
      remediation: `Ensure the '## Task Metadata' section contains exactly ${JSON.stringify(expected)} in order.`,
    });
  }
}

function validateLineageBlock(
  validator: PolicyValidator,
  relativePath: string,
  lines: string[],
): void {
  const sectionLines = extractSectionLines(lines, 'Task Lineage');
  const nestedSectionLines = sectionLines.length > 0
    ? sectionLines
    : extractNestedSectionLines(lines, 'Task Metadata', 'Task Lineage');
  const contentLines = nestedSectionLines.filter((l) => l.trim());

  if (!contentLines.length) {
    validator.addViolation({
      rule_id: 'template.lineage-labels',
      artifact: relativePath,
      message: 'Task Lineage section body is empty.',
      remediation: `Add lineage labels ${JSON.stringify([...LINEAGE_METADATA_LABELS])} to '## Task Lineage' in ${relativePath}.`,
    });
    return;
  }

  const observed = extractMetadataLabels(contentLines);
  const expected = [...LINEAGE_METADATA_LABELS];
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    validator.addViolation({
      rule_id: 'template.lineage-labels',
      artifact: relativePath,
      message: `Lineage labels must be ${JSON.stringify(expected)}, found ${JSON.stringify(observed)}.`,
      remediation: `Ensure the '## Task Lineage' section contains exactly ${JSON.stringify(expected)} in order.`,
    });
    return;
  }

  // Check Task Kind enum.
  const values: Record<string, string> = {};
  for (const entry of contentLines) {
    const match = METADATA_LINE.exec(entry.trim());
    if (match) {
      values[(match[1] ?? '').trim()] = (match[2] ?? '').trim();
    }
  }
  const taskKind = values['Task Kind'] ?? '';
  if (!ALLOWED_TASK_KINDS.has(taskKind)) {
    validator.addViolation({
      rule_id: 'template.task-kind-enum',
      artifact: relativePath,
      message: `Task Kind must be blank, 'standard', or 'child-task', found '${taskKind}'.`,
      remediation: "Set Task Kind to one of: blank, 'standard', 'child-task'.",
    });
  }
}

async function validateJsonTemplate(
  validator: PolicyValidator,
  relativePath: string,
  spec: JsonHandoffSpec,
): Promise<void> {
  const absolutePath = path.join(validator.rootDir, relativePath);
  const text = await readTextFile(absolutePath);
  if (text === undefined) {
    return;
  }

  let payload: unknown;
  try {
    payload = safeJsonParse(text, relativePath);
  } catch (exc) {
    validator.addViolation({
      rule_id: 'template.json-schema',
      artifact: relativePath,
      message: `Invalid JSON: ${exc instanceof Error ? exc.message : String(exc)}`,
      remediation: `Fix the JSON syntax error in ${relativePath}.`,
    });
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    validator.addViolation({
      rule_id: 'template.json-schema',
      artifact: relativePath,
      message: 'Top-level JSON value must be an object.',
      remediation: `Ensure ${relativePath} contains a JSON object.`,
    });
    return;
  }

  const obj = payload as Record<string, unknown>;
  for (const key of spec.required_top_level_keys) {
    if (!(key in obj)) {
      validator.addViolation({
        rule_id: 'template.json-schema',
        artifact: relativePath,
        message: `Missing required top-level key '${key}'.`,
        remediation: `Add '${key}' to ${relativePath}.`,
      });
    }
  }

  const schemaVersion = obj.schema_version;
  if (schemaVersion !== undefined && !Number.isInteger(schemaVersion)) {
    validator.addViolation({
      rule_id: 'template.json-schema',
      artifact: relativePath,
      message: "'schema_version' must be an integer.",
      remediation: "Set 'schema_version' to an integer value.",
    });
  }

  const assignments = obj.assignments;
  if (assignments !== undefined && !Array.isArray(assignments)) {
    validator.addViolation({
      rule_id: 'template.json-schema',
      artifact: relativePath,
      message: "'assignments' must be an array.",
      remediation: "Set 'assignments' to a JSON array.",
    });
  }
}
