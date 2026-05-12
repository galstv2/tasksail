import { readTextFile, writeTextFile, copyFileSafe } from '../core/index.js';
import { jsonEscapeString } from '../core/index.js';
import { templateSourceFor } from './paths.js';

function escapeLabel(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace `- LABEL:` lines with `- LABEL: VALUE` for each non-empty value.
 * All substitutions are applied in a single pass.
 */
export function injectLabelValues(
  content: string,
  labels: Record<string, string>,
): string {
  let result = content;
  for (const [label, value] of Object.entries(labels)) {
    if (!value) continue;
    const regex = new RegExp(`^- ${escapeLabel(label)}:$`, 'gm');
    result = result.replace(regex, `- ${label}: ${value}`);
  }
  return result;
}

export function setLabelValue(
  content: string,
  label: string,
  value: string,
): string {
  const lineRegex = new RegExp(`^- ${escapeLabel(label)}:(?:\\s*.*)?$`);
  const lines = content.split('\n');
  const result: string[] = [];
  let replaced = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (lineRegex.test(line.trim())) {
      result.push(`- ${label}: ${value}`);
      replaced = true;
      while (index + 1 < lines.length) {
        const next = lines[index + 1]!;
        if (next.trim() === '') {
          break;
        }
        if (!/^\s+/.test(next)) {
          break;
        }
        index += 1;
      }
      continue;
    }
    result.push(line);
  }

  return replaced ? result.join('\n') : content;
}

export function getLabelValue(
  content: string,
  label: string,
): string | undefined {
  const regex = new RegExp(`^- ${escapeLabel(label)}:(?:\\s*(.*))?$`);

  for (const line of content.split('\n')) {
    const match = regex.exec(line.trim());
    if (!match) continue;
    return (match[1] ?? '').trim();
  }

  return undefined;
}

/**
 * Inject content into the body of a `## Section` heading.
 * Inserts after the first blank line following the heading, or replaces
 * a placeholder comment line.
 */
export function injectSectionContent(
  content: string,
  sectionName: string,
  newContent: string,
): string {
  if (!newContent) return content;

  const lines = content.split('\n');
  const result: string[] = [];
  let inSection = false;
  let injected = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === `## ${sectionName}`) {
      inSection = true;
      result.push(line);
      continue;
    }

    if (inSection && !injected) {
      // Inject after the first blank line or replace a comment placeholder
      if (line.trim() === '') {
        result.push(line);
        result.push(...newContent.split('\n'));
        injected = true;
        inSection = false;
        continue;
      }
      if (/^<!--.*-->$/.test(line.trim())) {
        result.push(...newContent.split('\n'));
        injected = true;
        inSection = false;
        continue;
      }
      // Section heading immediately followed by content — inject after heading
      result.push('');
      result.push(...newContent.split('\n'));
      injected = true;
      inSection = false;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Copy a template to a destination and inject metadata + lineage labels.
 */
export async function stampHandoffTemplate(
  templatePath: string,
  destPath: string,
  metadata: Record<string, string>,
  lineage?: Record<string, string>,
  sections?: Record<string, string>,
): Promise<void> {
  const templateContent = await readTextFile(templatePath);
  if (templateContent === undefined) {
    throw new Error(`Template not found: ${templatePath}`);
  }

  let content = injectLabelValues(templateContent, metadata);
  if (lineage) {
    content = injectLabelValues(content, lineage);
  }
  if (sections) {
    for (const [sectionName, sectionContent] of Object.entries(sections)) {
      content = injectSectionContent(content, sectionName, sectionContent);
    }
  }

  await writeTextFile(destPath, content);
}

/**
 * Copy a JSON template and inject task_id and task_title values.
 */
export async function stampParallelAssignmentsTemplate(
  templatePath: string,
  destPath: string,
  taskInfo: { taskId: string; taskTitle: string },
): Promise<void> {
  await copyFileSafe(templatePath, destPath);

  const content = await readTextFile(destPath);
  if (content === undefined) {
    throw new Error(`Failed to read stamped template: ${destPath}`);
  }

  let result = content;
  if (taskInfo.taskId) {
    const escaped = jsonEscapeString(taskInfo.taskId);
    result = result.replace('"task_id": ""', `"task_id": "${escaped}"`);
  }
  if (taskInfo.taskTitle) {
    const escaped = jsonEscapeString(taskInfo.taskTitle);
    result = result.replace(
      '"task_title": ""',
      `"task_title": "${escaped}"`,
    );
  }

  await writeTextFile(destPath, result);
}

/**
 * Resolve the full path of a template given the templates directory.
 * Re-exported for convenience.
 */
export { templateSourceFor };
