import { extractMarkdownSection } from '../core/index.js';

/**
 * Extract the H1 heading text from markdown content.
 * Returns the heading text without the leading "# ".
 */
export function extractTaskTitle(content: string): string {
  const match = content.match(/^# +(.+)$/m);
  return match ? match[1].trim() : '';
}

/**
 * Format a single metadata line: `- LABEL: VALUE` or `- LABEL:` if value is empty.
 */
export function templateMetadataLine(label: string, value?: string): string {
  if (value) {
    return `- ${label}: ${value}`;
  }
  return `- ${label}:`;
}

/**
 * Format a complete Task Metadata block from key-value pairs.
 */
export function printTaskMetadataBlock(
  metadata: Record<string, string>,
): string {
  return Object.entries(metadata)
    .map(([label, value]) => templateMetadataLine(label, value))
    .join('\n');
}

/**
 * Format a complete Task Lineage block from key-value pairs.
 */
export function printTaskLineageBlock(
  lineage: Record<string, string>,
): string {
  return Object.entries(lineage)
    .map(([label, value]) => templateMetadataLine(label, value))
    .join('\n');
}

/**
 * Extract a value from a labeled line within the Task Lineage section.
 * Looks for `- LABEL: VALUE` within `## Task Lineage`.
 */
export function extractLineageValue(
  content: string,
  label: string,
): string {
  const section = extractMarkdownSection(content, 'Task Lineage');
  return extractLabeledValue(section, label);
}

/**
 * Extract a value from a labeled line within the Task Metadata section.
 * Looks for `- LABEL: VALUE` within `## Task Metadata`.
 */
export function extractTaskMetadataValue(
  content: string,
  label: string,
): string {
  const section = extractMarkdownSection(content, 'Task Metadata');
  return extractLabeledValue(section, label);
}

/**
 * Context pack focus state captured at task submission time.
 * When present, the pipeline uses these values instead of the global env.
 */
export interface TaskContextPackBinding {
  contextPackDir: string;
  contextPackId: string;
  scopeMode: string;
  selectedRepoIds: string[];
  selectedFocusIds: string[];
}

/**
 * Extract context pack binding from task markdown.
 * Returns null when the section is absent or Context Pack Dir is empty
 * (legacy tasks created before this feature).
 */
export function extractContextPackBinding(
  content: string,
): TaskContextPackBinding | null {
  const section = extractMarkdownSection(content, 'Context Pack Binding');
  if (!section.trim()) return null;

  const dir = extractLabeledValue(section, 'Context Pack Dir');
  if (!dir) return null;

  return {
    contextPackDir: dir,
    contextPackId: extractLabeledValue(section, 'Context Pack ID'),
    scopeMode: extractLabeledValue(section, 'Scope Mode'),
    selectedRepoIds: commaSplit(extractLabeledValue(section, 'Selected Repo IDs')),
    selectedFocusIds: commaSplit(extractLabeledValue(section, 'Selected Focus IDs')),
  };
}

/**
 * Format a context pack binding as a markdown section.
 * Inverse of extractContextPackBinding — owns the canonical label format.
 */
export function formatContextPackBindingSection(binding: {
  contextPackDir?: string;
  contextPackId?: string;
  scopeMode?: string;
  selectedRepoIds?: string[];
  selectedFocusIds?: string[];
}): string {
  return [
    '## Context Pack Binding',
    '',
    `- Context Pack Dir: ${binding.contextPackDir ?? ''}`,
    `- Context Pack ID: ${binding.contextPackId ?? ''}`,
    `- Scope Mode: ${binding.scopeMode ?? ''}`,
    `- Selected Repo IDs: ${(binding.selectedRepoIds ?? []).join(', ')}`,
    `- Selected Focus IDs: ${(binding.selectedFocusIds ?? []).join(', ')}`,
  ].join('\n');
}

function commaSplit(value: string): string[] {
  return value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [];
}

/**
 * Extract a value from a `- LABEL: VALUE` line in a block of text.
 */
function extractLabeledValue(text: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^- ${escapedLabel}:\\s*(.*)$`, 'm');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}
