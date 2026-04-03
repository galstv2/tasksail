/**
 * Intake quality validation rules for planning agent artifacts.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_intake.py
 */

import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { readTextFile } from '../../core/index.js';
import {
  INTAKE_CHILD_TASK_REQUIRED_LINEAGE_FIELDS,
  INTAKE_CHILD_TASK_REQUIRED_SECTIONS,
  INTAKE_RECOMMENDED_SECTIONS,
  INTAKE_REQUEST_SUMMARY_MIN_LENGTH,
  INTAKE_REQUIRED_SECTIONS,
  METADATA_LINE,
} from '../models.js';
import { extractBulletItems, normalizeText } from '../matching.js';
import { parseSections } from '../artifacts.js';
import type { PolicyValidator } from '../validator.js';

const H1_HEADING = /^#\s+(.*\S)\s*$/m;
const INTAKE_DIRS = ['AgentWorkSpace/dropbox', 'AgentWorkSpace/pendingitems'];

async function discoverIntakeFiles(
  rootDir: string,
): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const results: Array<{ relativePath: string; absolutePath: string }> = [];

  for (const relDir of INTAKE_DIRS) {
    const directory = path.join(rootDir, relDir);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile()) {
          continue;
        }
        if (!entry.name.endsWith('.md')) {
          continue;
        }
        if (entry.name === '.active-item') {
          continue;
        }
        results.push({
          relativePath: `${relDir}/${entry.name}`,
          absolutePath: path.join(directory, entry.name),
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        continue;
      }
      throw error;
    }
  }

  return results;
}

function extractH1Title(text: string): string {
  const match = H1_HEADING.exec(text);
  return match ? (match[1] ?? '').trim() : '';
}

function extractTaskKind(sections: Record<string, string[]>): string {
  const lineageLines = sections['Task Lineage'] ?? [];
  for (const line of lineageLines) {
    const match = METADATA_LINE.exec(line.trim());
    if (match && (match[1] ?? '').trim() === 'Task Kind') {
      return (match[2] ?? '').trim();
    }
  }
  return '';
}

function extractLineageField(
  sections: Record<string, string[]>,
  fieldName: string,
): string {
  const lineageLines = sections['Task Lineage'] ?? [];
  for (const line of lineageLines) {
    const match = METADATA_LINE.exec(line.trim());
    if (match && (match[1] ?? '').trim() === fieldName) {
      return (match[2] ?? '').trim();
    }
  }
  return '';
}

export async function evaluateIntakeQualityRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('intake.title-present');
  validator.recordRule('intake.required-section-present');
  validator.recordRule('intake.recommended-section-present');
  validator.recordRule('intake.routing-recommendation-valid');
  validator.recordRule('intake.acceptance-signals-measurable');
  validator.recordRule('intake.request-summary-substantive');
  validator.recordRule('intake.child-lineage-required');
  validator.recordRule('intake.child-carry-forward-required');

  if (validator.mode !== 'lint' && validator.mode !== 'ci') {
    return;
  }

  const intakeFiles = await discoverIntakeFiles(validator.rootDir);
  if (intakeFiles.length === 0) {
    return;
  }

  for (const { relativePath, absolutePath } of intakeFiles) {
    const text = await readTextFile(absolutePath);
    if (!text?.trim()) {
      continue;
    }
    validateSingleIntake(validator, relativePath, text);
  }
}

function validateSingleIntake(
  validator: PolicyValidator,
  relPath: string,
  text: string,
): void {
  const title = extractH1Title(text);
  if (!title) {
    validator.addViolation({
      rule_id: 'intake.title-present',
      artifact: relPath,
      message: 'Intake file is missing an H1 heading.',
      remediation: `Add a '# <Task Title>' heading to ${relPath}.`,
    });
  }

  const sections = parseSections(text);

  for (const sectionName of INTAKE_REQUIRED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'intake.required-section-present',
        artifact: relPath,
        message: `Required section '${sectionName}' is missing or empty.`,
        remediation: `Add a non-empty '## ${sectionName}' section to ${relPath}.`,
      });
    }
  }

  for (const sectionName of INTAKE_RECOMMENDED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'intake.recommended-section-present',
        artifact: relPath,
        severity: 'warning',
        message: `Recommended section '${sectionName}' is missing or empty.`,
        remediation: `Consider adding a '## ${sectionName}' section to ${relPath}.`,
      });
    }
  }

  validateSuggestedRouting(validator, relPath, sections);

  const acItems = extractBulletItems(sections['Acceptance Signals'] ?? []);
  const acContent = normalizeText(sections['Acceptance Signals'] ?? []);
  if (acContent && !acItems.length) {
    validator.addViolation({
      rule_id: 'intake.acceptance-signals-measurable',
      artifact: relPath,
      message: 'Acceptance Signals must contain at least one bullet or numbered item.',
      remediation: `Add bulleted or numbered acceptance signals to '## Acceptance Signals' in ${relPath}.`,
    });
  }

  const summaryContent = normalizeText(sections['Request Summary'] ?? []);
  if (summaryContent && summaryContent.length < INTAKE_REQUEST_SUMMARY_MIN_LENGTH) {
    validator.addViolation({
      rule_id: 'intake.request-summary-substantive',
      artifact: relPath,
      message: `Request Summary is only ${summaryContent.length} characters; minimum is ${INTAKE_REQUEST_SUMMARY_MIN_LENGTH}.`,
      remediation: `Expand the '## Request Summary' section in ${relPath} to at least ${INTAKE_REQUEST_SUMMARY_MIN_LENGTH} characters.`,
    });
  }

  const taskKind = extractTaskKind(sections);
  if (taskKind === 'child-task') {
    validateChildTaskIntake(validator, relPath, sections);
  }
}

function validateChildTaskIntake(
  validator: PolicyValidator,
  relPath: string,
  sections: Record<string, string[]>,
): void {
  const missing = INTAKE_CHILD_TASK_REQUIRED_LINEAGE_FIELDS.filter(
    (f) => !extractLineageField(sections, f),
  );
  if (missing.length > 0) {
    validator.addViolation({
      rule_id: 'intake.child-lineage-required',
      artifact: relPath,
      message: `Task Kind is 'child-task' but required lineage fields are missing: ${missing.join(', ')}.`,
      remediation: `Populate all child-task lineage fields (${INTAKE_CHILD_TASK_REQUIRED_LINEAGE_FIELDS.join(', ')}) in ${relPath}.`,
    });
  }

  for (const sectionName of INTAKE_CHILD_TASK_REQUIRED_SECTIONS) {
    const content = normalizeText(sections[sectionName] ?? []);
    if (!content) {
      validator.addViolation({
        rule_id: 'intake.child-carry-forward-required',
        artifact: relPath,
        message: `Task Kind is 'child-task' but '${sectionName}' is missing or empty.`,
        remediation: `Add substantive content to '## ${sectionName}' in ${relPath}.`,
      });
    }
  }
}

function validateSuggestedRouting(
  validator: PolicyValidator,
  relPath: string,
  sections: Record<string, string[]>,
): void {
  const routingLines = sections['Suggested Routing'] ?? [];
  if (!routingLines.length) {
    return;
  }

  for (const line of routingLines) {
    const match = METADATA_LINE.exec(line.trim());
    if (!match) {
      continue;
    }
    if ((match[1] ?? '').trim() !== 'Recommended Execution') {
      continue;
    }
    const value = (match[2] ?? '').trim();
    if (value === 'simple' || value === 'complex') {
      return;
    }
    validator.addViolation({
      rule_id: 'intake.routing-recommendation-valid',
      artifact: relPath,
      message: "Suggested Routing must set 'Recommended Execution' to 'Simple' or 'Complex'.",
      remediation: `Set '- Recommended Execution: simple' or '- Recommended Execution: complex' in ${relPath}.`,
    });
    return;
  }

  if (normalizeText(routingLines)) {
    validator.addViolation({
      rule_id: 'intake.routing-recommendation-valid',
      artifact: relPath,
      message:
        "Suggested Routing should use the metadata line '- Recommended Execution: simple|complex'.",
      remediation: `Replace freeform Suggested Routing text with '- Recommended Execution: simple' or '- Recommended Execution: complex' in ${relPath}.`,
    });
  }
}
