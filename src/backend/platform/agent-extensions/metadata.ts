import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { PluginMetadataSummary } from '../cli-provider/index.js';
import { extensionError } from './ids.js';
import type { AgentExtensionKind, AgentExtensionRuntimeCatalogEntry } from './types.js';

type MetadataResult = Pick<AgentExtensionRuntimeCatalogEntry, 'display_name' | 'description' | 'metadata'>;
type PluginMetadataInspector = (runtimePath: string) => Promise<PluginMetadataSummary & { description?: string }>;

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

async function inspectPluginMetadata(
  runtimePath: string,
  inspect: PluginMetadataInspector,
): Promise<MetadataResult> {
  const summary = await inspect(runtimePath);
  const description =
    typeof summary.description === 'string' && summary.description.trim() !== ''
      ? summary.description.trim()
      : `Plugin ${summary.name}.`;

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
  kind: AgentExtensionKind;
  runtimePath: string;
  inspectPluginMetadata?: PluginMetadataInspector;
}): Promise<MetadataResult> {
  if (input.kind === 'skill') {
    return inspectSkillMetadata(input.runtimePath);
  }
  if (!input.inspectPluginMetadata) {
    throw new Error('Plugin metadata inspection requires an active provider inspector.');
  }
  return inspectPluginMetadata(input.runtimePath, input.inspectPluginMetadata);
}
