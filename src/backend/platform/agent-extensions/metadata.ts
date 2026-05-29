import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { isRecord } from '../core/guards.js';
import { safeJsonParse } from '../core/io.js';
import { extensionError } from './ids.js';
import type { AgentExtensionKind, AgentExtensionRuntimeCatalogEntry } from './types.js';

type MetadataResult = Pick<AgentExtensionRuntimeCatalogEntry, 'display_name' | 'description' | 'metadata'>;

// Minimal YAML frontmatter extractor — only handles simple key: value lines
function extractYamlFrontmatter(content: string): Record<string, string> | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const result: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const match = /^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+)$/.exec(line);
    if (match) {
      result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return result;
}

async function inspectSkillMetadata(runtimePath: string): Promise<MetadataResult> {
  const skillMdPath = path.join(runtimePath, 'SKILL.md');
  let raw: string;
  try {
    raw = await readFile(skillMdPath, 'utf-8');
  } catch {
    throw extensionError('skill-md-missing', 'SKILL.md not found in the extension runtime copy.');
  }

  const frontmatter = extractYamlFrontmatter(raw);
  if (!frontmatter) {
    throw new Error('SKILL.md is missing YAML frontmatter.');
  }

  const name = frontmatter.name;
  const description = frontmatter.description;

  if (!name || name.trim() === '') {
    throw new Error('SKILL.md frontmatter is missing a non-empty name field.');
  }
  if (!description || description.trim() === '') {
    throw new Error('SKILL.md frontmatter is missing a non-empty description field.');
  }

  return {
    display_name: name.trim(),
    description: description.trim(),
    metadata: { skill_names: [name.trim()] },
  };
}

async function inspectPluginMetadata(runtimePath: string): Promise<MetadataResult> {
  const { readCopilotPluginManifestSummary } = await import(
    '../cli-provider/providers/copilot/launchExtensions.js'
  );
  const summary = await readCopilotPluginManifestSummary(runtimePath);

  // Read description from manifest JSON directly
  const manifestPath = summary.manifestPath;
  let description = '';
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const parsed = safeJsonParse<unknown>(raw, manifestPath);
    if (isRecord(parsed) && typeof parsed.description === 'string' && parsed.description.trim() !== '') {
      description = parsed.description.trim();
    }
  } catch {
    // fall through to fail-closed check
  }

  if (!description) {
    throw new Error('Plugin manifest is missing a non-empty description field.');
  }

  return {
    display_name: summary.name,
    description,
    metadata: {
      plugin_component_classes: summary.declaredComponentClasses,
      plugin_skill_count: summary.skillPathCount,
    },
  };
}

export async function inspectAgentExtensionMetadata(input: {
  providerId: 'copilot';
  kind: AgentExtensionKind;
  runtimePath: string;
}): Promise<MetadataResult> {
  if (input.kind === 'skill') {
    return inspectSkillMetadata(input.runtimePath);
  }
  return inspectPluginMetadata(input.runtimePath);
}
