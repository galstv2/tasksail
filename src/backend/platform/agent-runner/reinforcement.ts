import type { AgentId } from '../core/index.js';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { runPython, writeTextFile } from '../core/index.js';
import type { ResolvedContext } from './types.js';
import { resolveBehavioralBaseRegistryId } from './conventions.js';
import { getActiveProvider } from '../cli-provider/index.js';
import type { CliProvider } from '../cli-provider/index.js';

/** Active workflow roles consume reinforcement context. */
const REINFORCEMENT_AGENTS = new Set([
  'planning-agent',
  'product-manager',
  'software-engineer',
  'qa',
]);

/**
 * Check whether an agent role requires reinforcement context injection.
 */
export function roleRequiresReinforcement(provider: CliProvider, agentId: AgentId): boolean {
  return REINFORCEMENT_AGENTS.has(resolveBehavioralBaseRegistryId(provider, agentId));
}

function helperPathForRepo(repoRoot: string): string {
  return path.join(
    repoRoot,
    'src',
    'backend',
    'scripts',
    'python',
    'run-role-agent-helper.py',
  );
}

function renderedContextPath(repoRoot: string, baseAgentId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'reinforcement',
    `${baseAgentId}.md`,
  );
}

function renderedExportPath(repoRoot: string, baseAgentId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'reinforcement',
    `${baseAgentId}.env`,
  );
}

function diagnosticsPath(repoRoot: string, baseAgentId: string): string {
  return path.join(
    repoRoot,
    '.platform-state',
    'runtime',
    'reinforcement',
    `${baseAgentId}.diagnostics.json`,
  );
}

async function recordReinforcementDiagnostics(
  repoRoot: string,
  baseAgentId: string,
  resolved: ResolvedContext,
): Promise<void> {
  const payload = `${JSON.stringify({
    agentId: baseAgentId,
    status: resolved.status,
    reason: resolved.reason,
    injectionEnabled: resolved.injectionEnabled,
    contextFile: resolved.contextFile,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`;
  await writeTextFile(diagnosticsPath(repoRoot, baseAgentId), payload);
}

async function returnWithDiagnostics(
  repoRoot: string,
  baseAgentId: string,
  resolved: ResolvedContext,
): Promise<ResolvedContext> {
  try {
    await recordReinforcementDiagnostics(repoRoot, baseAgentId, resolved);
  } catch {
    // Non-fatal: diagnostics must not block agent launch.
  }
  return resolved;
}

function parseRenderedStatus(markdown: string): { status: string | undefined; reason: string | undefined } {
  let status: string | undefined;
  let reason: string | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const statusMatch = line.match(/^- Status:\s*(.+?)\s*$/);
    if (statusMatch) {
      status = statusMatch[1]?.trim();
      continue;
    }
    const reasonMatch = line.match(/^- Reason:\s*(.+?)\s*$/);
    if (reasonMatch) {
      reason = reasonMatch[1]?.trim();
    }
  }
  return { status, reason };
}

/**
 * Resolve reinforcement context for an agent.
 *
 * This is the TypeScript launch-time source of truth for rendered
 * reinforcement context. It asks the Python renderer to materialize a bounded
 * runtime markdown document, then only enables injection when that rendered
 * document declares itself available.
 */
export async function resolveReinforcementContext(
  agentId: AgentId,
  contextPackDir: string | undefined,
  repoRoot: string,
): Promise<ResolvedContext> {
  const provider = getActiveProvider(repoRoot);
  if (!roleRequiresReinforcement(provider, agentId)) {
    return {
      status: 'not-applicable',
      reason: 'Agent role does not require reinforcement context by default.',
      injectionEnabled: false,
    };
  }

  const baseAgentId = resolveBehavioralBaseRegistryId(provider, agentId);

  if (!contextPackDir) {
    return returnWithDiagnostics(repoRoot, baseAgentId, {
      status: 'unavailable',
      reason: 'No active context pack is selected in ACTIVE_CONTEXT_PACK_DIR.',
      injectionEnabled: false,
    });
  }

  const outputPath = renderedContextPath(repoRoot, baseAgentId);
  const exportPath = renderedExportPath(repoRoot, baseAgentId);

  try {
    await runPython(
      helperPathForRepo(repoRoot),
      [
        'render-reinforcement-context',
        contextPackDir,
        baseAgentId,
        outputPath,
        exportPath,
        '--repo-root',
        repoRoot,
      ],
      {
        cwd: repoRoot,
  // Bound the pre-launch render so a hung helper (e.g. blocked
        // on a corrupt/locked QMD file written by a prior run) cannot stall the
        // agent pipeline indefinitely. Matches reinforcementWrite.ts. The catch
        // below degrades to an 'unavailable' status rather than crashing.
        timeout: 30_000,
        env: {
          TASKSAIL_CLI_HOME_DIR_NAME: provider.homeDirName(),
          TASKSAIL_AGENT_REGISTRY_PATH: path.join(
            repoRoot,
            provider.agentConfigPaths().registry,
          ),
        },
      },
    );
  } catch (error) {
    return returnWithDiagnostics(repoRoot, baseAgentId, {
      status: 'unavailable',
      reason: `Reinforcement context failed to render: ${error instanceof Error ? error.message : String(error)}`,
      injectionEnabled: false,
    });
  }

  try {
    const rendered = await readFile(outputPath, 'utf-8');
    const trimmed = rendered.trim();
    const { status, reason } = parseRenderedStatus(trimmed);
    if (status === 'available' && trimmed) {
      return returnWithDiagnostics(repoRoot, baseAgentId, {
        status: 'available',
        reason: 'Rendered reinforcement context available for launch overlay.',
        injectionEnabled: true,
        contextFile: outputPath,
      });
    }

    return returnWithDiagnostics(repoRoot, baseAgentId, {
      status: status === 'malformed' ? 'malformed' : 'unavailable',
      reason: reason ?? 'Rendered reinforcement context is unavailable.',
      injectionEnabled: false,
    });
  } catch (error) {
    return returnWithDiagnostics(repoRoot, baseAgentId, {
      status: 'unavailable',
      reason: `Rendered reinforcement context is stale or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      injectionEnabled: false,
    });
  }
}
