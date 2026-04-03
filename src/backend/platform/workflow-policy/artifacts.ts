import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readEnvAssignment, readTextFile } from '../core/index.js';
import { readRuntimeWorkflowFacts } from '../agent-runner/runtimeFacts.js';
import {
  ACTIVE_ITEM_RELATIVE_PATH,
  CONTENT_SECTION_EXCLUSIONS,
  METADATA_LINE,
  SECTION_HEADING,
} from './models.js';
import {
  markdownSectionsHaveContent,
  normalizeText,
  stripHtmlComments,
} from './matching.js';
import type { WorkspaceArtifact } from './types.js';

export function parseSections(text: string | null | undefined): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection: string | null = null;

  for (const rawLine of (text ?? '').split(/\r?\n/)) {
    const match = SECTION_HEADING.exec(rawLine.trim());
    if (match?.[1]) {
      currentSection = match[1];
      sections[currentSection] ??= [];
      continue;
    }

    if (currentSection) {
      sections[currentSection]!.push(rawLine);
    }
  }

  return sections;
}

export function parseMetadata(lines: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of lines) {
    const match = METADATA_LINE.exec(line.trim());
    if (match?.[1]) {
      values[match[1]] = (match[2] ?? '').trim();
    }
  }

  return values;
}

export async function loadWorkspaceArtifact(
  rootDir: string,
  relativePath: string,
): Promise<WorkspaceArtifact> {
  const absolutePath = path.join(rootDir, relativePath);
  const rawText = await readTextFile(absolutePath);
  const sections = parseSections(rawText ?? '');

  return {
    relativePath,
    exists: rawText !== undefined,
    sections,
    metadata: parseMetadata(sections['Task Metadata'] ?? []),
    taskLineage: parseMetadata(sections['Task Lineage'] ?? []),
    hasSubstantiveContent: markdownSectionsHaveContent(sections, {
      excludedSections: CONTENT_SECTION_EXCLUSIONS,
    }),
  };
}

export async function listSliceFiles(stepsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(stepsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'slice-template.md')
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
): Promise<boolean> {
  const runtimeFacts = await readRuntimeWorkflowFacts(rootDir);
  const authoritative = runtimeFacts?.parallel?.active_approval;
  if (typeof authoritative === 'boolean') {
    return authoritative;
  }

  const decisionText = normalizeText(stripHtmlComments(artifact.sections.Decision ?? [])).toLowerCase();
  return decisionText.includes('complex') && !decisionText.includes('simple');
}

export async function hasPendingMarkdownFiles(rootDir: string): Promise<boolean> {
  const pendingDir = path.join(rootDir, 'AgentWorkSpace', 'pendingitems');
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

export async function activeItemExists(rootDir: string): Promise<boolean> {
  const activeItemPath = path.join(rootDir, ACTIVE_ITEM_RELATIVE_PATH);
  const activeItem = (await readTextFile(activeItemPath))?.trim();
  if (!activeItem) {
    return false;
  }

  const candidate = path.join(rootDir, 'AgentWorkSpace', 'pendingitems', activeItem);
  return (await readTextFile(candidate)) !== undefined;
}

export async function inferContextPackDir(
  rootDir: string,
  contextPackDir?: string,
): Promise<string | null> {
  if (contextPackDir) {
    return path.resolve(contextPackDir);
  }

  const envValue = await readEnvAssignment(path.join(rootDir, '.env'), 'ACTIVE_CONTEXT_PACK_DIR');
  const resolvedValue = envValue || process.env.ACTIVE_CONTEXT_PACK_DIR || '';

  if (!resolvedValue) {
    return null;
  }

  return path.resolve(resolvedValue);
}

