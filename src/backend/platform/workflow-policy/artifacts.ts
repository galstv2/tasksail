import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readTextFile, resolvePaths, stripHtmlComments } from '../core/index.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/active.js';
import { resolveQueuePaths, type QueuePaths } from '../queue/paths.js';
import { readRuntimeWorkflowFacts } from '../agent-runner/runtimeFacts.js';
import {
  CONTENT_SECTION_EXCLUSIONS,
  METADATA_LINE,
  SECTION_HEADING,
  type SemanticSectionSpec,
} from './models.js';
import { loadMarkdownContract } from './contracts/markdownContract.js';
import { SECTION_NAMES } from './contracts/sectionNames.js';

import {
  markdownSectionsHaveContent,
  normalizeIdentifier,
  normalizeText,
  stripHtmlComments as stripHtmlCommentsLines,
} from './matching.js';
import { SLICE_TEMPLATE_RELATIVE_PATH } from './rules/templateSpecs.js';
import { LINEAGE_METADATA_LABELS } from './rules/templateSpecs.js';
import type { WorkspaceArtifact } from './types.js';

const NESTED_SECTION_HEADING = /^(#{3,6})\s+(.*\S)\s*$/;
const MARKDOWN_CONTRACT = loadMarkdownContract();

export function parseSections(text: string | null | undefined): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;
  let inFence: string | null = null;

  const lines = (text ?? '').split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }

  for (const rawLine of lines) {
    if (inFence && rawLine.trim() === inFence) {
      inFence = null;
    } else {
      const fenceMatch = MARKDOWN_CONTRACT.compiled.fenceOpen.exec(rawLine);
      if (fenceMatch?.[MARKDOWN_CONTRACT.groups.fenceMarker]) {
        inFence = fenceMatch[MARKDOWN_CONTRACT.groups.fenceMarker]!;
      }
    }

    const match = inFence ? null : SECTION_HEADING.exec(rawLine.trim());
    if (match?.[MARKDOWN_CONTRACT.groups.headingName]) {
      currentSection = match[MARKDOWN_CONTRACT.groups.headingName]!;
      sections[currentSection] ??= [];
      continue;
    }

    if (currentSection) {
      sections[currentSection]!.push(rawLine);
    }
  }

  return sections;
}

export function stripHtmlCommentsFromSections(
  sections: Record<string, string[]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(sections).map(([sectionName, lines]) => [
      sectionName,
      stripHtmlCommentsLines(lines),
    ]),
  );
}

export function parseSemanticSections(
  text: string | null | undefined,
): Record<string, string[]> {
  return stripHtmlCommentsFromSections(parseSections(text));
}

export function parseMetadata(lines: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of lines) {
    const match = METADATA_LINE.exec(line.trim());
    if (match?.[MARKDOWN_CONTRACT.groups.labelName]) {
      values[match[MARKDOWN_CONTRACT.groups.labelName]!] ??= stripHtmlComments(
        match[MARKDOWN_CONTRACT.groups.labelValue] ?? '',
      ).trim();
    }
  }

  return values;
}

export interface ResolvedSemanticSection {
  heading: string | null;
  content: string[];
  source: 'direct-heading' | 'nested-heading' | 'container-heading' | 'missing';
}

function findSectionEntry(
  sections: Record<string, string[]>,
  headings: readonly string[],
): { heading: string; content: string[] } | null {
  const normalizedHeadings = new Set(headings.map((heading) => normalizeIdentifier(heading)));
  for (const [sectionName, lines] of Object.entries(sections)) {
    if (normalizedHeadings.has(normalizeIdentifier(sectionName))) {
      return { heading: sectionName, content: lines };
    }
  }
  return null;
}

function findNestedSection(
  lines: readonly string[],
  headings: readonly string[],
): { heading: string; content: string[] } | null {
  const normalizedHeadings = new Set(headings.map((heading) => normalizeIdentifier(heading)));
  let activeHeading: string | null = null;
  let activeLevel = 0;
  let activeContent: string[] = [];

  for (const rawLine of lines) {
    const match = NESTED_SECTION_HEADING.exec(rawLine.trim());
    if (match?.[2]) {
      const level = (match[1] ?? '').length;
      const title = match[2];

      if (activeHeading && level <= activeLevel) {
        return { heading: activeHeading, content: activeContent };
      }

      if (!activeHeading && normalizedHeadings.has(normalizeIdentifier(title))) {
        activeHeading = title;
        activeLevel = level;
        activeContent = [];
        continue;
      }
    }

    if (activeHeading) {
      activeContent.push(rawLine);
    }
  }

  return activeHeading ? { heading: activeHeading, content: activeContent } : null;
}

export function resolveSemanticSection(
  sections: Record<string, string[]>,
  sectionSpec: SemanticSectionSpec,
): ResolvedSemanticSection {
  const directHeadings = [sectionSpec.preferredHeading, ...(sectionSpec.aliases ?? [])];
  const directMatch = findSectionEntry(sections, directHeadings);
  if (directMatch) {
    return {
      heading: directMatch.heading,
      content: directMatch.content,
      source: 'direct-heading',
    };
  }

  for (const containerHeading of sectionSpec.containerHeadings ?? []) {
    const containerMatch = findSectionEntry(sections, [containerHeading]);
    if (!containerMatch) {
      continue;
    }

    const nestedMatch = findNestedSection(containerMatch.content, directHeadings);
    if (nestedMatch) {
      return {
        heading: nestedMatch.heading,
        content: nestedMatch.content,
        source: 'nested-heading',
      };
    }

    if (sectionSpec.allowContainerFallback !== false) {
      return {
        heading: containerMatch.heading,
        content: containerMatch.content,
        source: 'container-heading',
      };
    }
  }

  return {
    heading: null,
    content: [],
    source: 'missing',
  };
}

export function parseArtifactMetadata(
  sections: Record<string, string[]>,
): { metadata: Record<string, string>; taskLineage: Record<string, string> } {
  const taskMetadataLines = sections[SECTION_NAMES.TASK_METADATA] ?? [];
  const parsedTaskMetadata = parseMetadata(taskMetadataLines);
  const nestedTaskLineage =
    findNestedSection(taskMetadataLines, [SECTION_NAMES.TASK_LINEAGE])?.content
    ?? [];
  const taskLineageLines = sections[SECTION_NAMES.TASK_LINEAGE] ?? nestedTaskLineage;
  const parsedTaskLineage = parseMetadata(taskLineageLines.length > 0 ? taskLineageLines : taskMetadataLines);
  const metadata = Object.fromEntries(
    Object.entries(parsedTaskMetadata).filter(([label]) =>
      !LINEAGE_METADATA_LABELS.includes(label as (typeof LINEAGE_METADATA_LABELS)[number])),
  );

  return {
    metadata,
    taskLineage: Object.fromEntries(
      Object.entries(parsedTaskLineage).filter(([label]) =>
        LINEAGE_METADATA_LABELS.includes(label as (typeof LINEAGE_METADATA_LABELS)[number])),
    ),
  };
}

export async function loadWorkspaceArtifact(
  rootDir: string,
  relativePath: string,
): Promise<WorkspaceArtifact> {
  const absolutePath = path.join(rootDir, relativePath);
  const rawText = await readTextFile(absolutePath);
  const rawSections = parseSections(rawText ?? '');
  const sections = stripHtmlCommentsFromSections(rawSections);

  return {
    relativePath,
    exists: rawText !== undefined,
    sections,
    ...parseArtifactMetadata(sections),
    hasSubstantiveContent: markdownSectionsHaveContent(sections, {
      excludedSections: CONTENT_SECTION_EXCLUSIONS,
    }),
  };
}

export async function listSliceFiles(stepsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(stepsDir, { withFileTypes: true });
    const sliceTemplateName = path.basename(SLICE_TEMPLATE_RELATIVE_PATH);
    return entries
      .filter((entry) => (
        entry.isFile()
        && entry.name.endsWith('.md')
        && entry.name !== sliceTemplateName
      ))
      .map((entry) => path.join(stepsDir, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function parallelOkHasActiveApproval(
  rootDir: string,
  artifact: WorkspaceArtifact,
  taskId?: string,
): Promise<boolean> {
  const taskRuntime = taskId
    ? resolvePaths({ repoRoot: rootDir, taskId }).taskRuntime
    : path.join(rootDir, '.platform-state', 'runtime');
  const runtimeFacts = await readRuntimeWorkflowFacts(taskRuntime);
  const authoritative = runtimeFacts?.parallel?.active_approval;
  if (typeof authoritative === 'boolean') {
    return authoritative;
  }

  const decisionText = normalizeText(stripHtmlCommentsLines(artifact.sections[SECTION_NAMES.DECISION] ?? [])).toLowerCase();
  return decisionText.includes('complex') && !decisionText.includes('simple');
}

export async function hasPendingMarkdownFiles(rootDir: string): Promise<boolean> {
  const pendingDir = resolveQueuePaths(rootDir).pendingDir;
  try {
    const entries = await readdir(pendingDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith('.md'));
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Check whether a specific task's active marker exists in .active-items/.
 * Callers MUST pass taskId explicitly.
 */
export function activeTaskMarkerExists(queuePaths: QueuePaths, taskId: string): boolean {
  return existsSync(path.join(queuePaths.activeItemsDir, taskId));
}

export async function inferContextPackDir(
  rootDir: string,
  contextPackDir?: string,
): Promise<string | null> {
  if (contextPackDir) {
    return path.resolve(contextPackDir);
  }

  // Use the policy layer helper which reads the .task.json sidecar when
  // TASKSAIL_TASK_ID is set, and falls back to the singleton .env path
  // only when no task is active. Direct .env / process.env reads are
  // UI-state only and must not be used on the task-launch path.
  try {
    return await requireAuthorizedActiveContextPack({ repoRoot: rootDir });
  } catch {
    return null;
  }
}
