import {
  getExternalServersForAgent,
  type ExternalMcpRegistry,
  type ExternalMcpServer,
} from '../../external-mcp-registry/index.js';

export interface McpPromptContextOptions {
  heading?: string;
  introLine?: string;
}

function sanitizePromptText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/`+/g, '\'')
    .replace(/\s+/g, ' ')
    .trim();
}

function quotePromptText(value: string): string {
  return `"${sanitizePromptText(value).replace(/"/g, '\\"')}"`;
}

function formatPreferredFor(preferredFor: readonly string[]): string | undefined {
  const formatted = preferredFor
    .map((item) => sanitizePromptText(item))
    .filter((item) => item.length > 0);

  if (formatted.length === 0) {
    return undefined;
  }

  return formatted.map(quotePromptText).join(', ');
}

function formatServerGuidance(server: ExternalMcpServer): string[] {
  const lines = [
    `- ${quotePromptText(server.display_name)} may help with ${sanitizePromptText(server.purpose)}`,
  ];

  const preferredFor = server.preferred_for
    ? formatPreferredFor(server.preferred_for)
    : undefined;
  if (preferredFor) {
    lines.push(`  Consider it when the task involves ${preferredFor}.`);
  }

  const fallbackDescription = server.fallback_description
    ? sanitizePromptText(server.fallback_description)
    : undefined;
  if (fallbackDescription) {
    lines.push(`  If it is not the best fit, ${fallbackDescription}.`);
  }

  return lines;
}

/**
 * Build a reusable runtime prompt block from already-scoped external MCP
 * server metadata. Returns undefined when no eligible servers are present.
 */
export function buildMcpContextBlockFromServers(
  servers: readonly ExternalMcpServer[],
  options: McpPromptContextOptions = {},
): string | undefined {
  const applicableServers = servers.filter((server) => server.enabled);
  if (applicableServers.length === 0) {
    return undefined;
  }

  const heading = options.heading ?? '## External MCP Guidance';
  const introLine = options.introLine
    ?? 'The following external MCP servers are available for this role. Consider them when their descriptions fit the task, and continue with your other tools when they do not.';

  const parts = [heading, '', introLine, ''];
  for (const server of applicableServers) {
    parts.push(...formatServerGuidance(server), '');
  }

  return parts.join('\n').trimEnd();
}

/**
 * Build a reusable runtime prompt block from the external MCP registry for a
 * specific agent-scoped registry ID. Returns undefined when the scope is empty.
 */
export function buildMcpContextBlock(
  registry: ExternalMcpRegistry | undefined,
  agentId: string,
  options: McpPromptContextOptions = {},
): string | undefined {
  if (!registry) {
    return undefined;
  }

  return buildMcpContextBlockFromServers(
    getExternalServersForAgent(registry, agentId),
    options,
  );
}

/**
 * Append the external MCP guidance block to prompt parts when agent-scoped
 * servers are available. No-op when no scoped servers are present.
 */
export function appendMcpContextBlock(
  parts: string[],
  registry: ExternalMcpRegistry | undefined,
  agentId: string,
  options?: McpPromptContextOptions,
): void {
  const block = buildMcpContextBlock(registry, agentId, options);
  if (block) {
    parts.push(block, '');
  }
}
