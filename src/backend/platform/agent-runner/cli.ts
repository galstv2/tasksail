/**
 * Canonical operator entrypoint for role-agent orchestration.
 *
 * Exposed via:
 *   pnpm run agent          -- runs the "run" subcommand
 *   pnpm run agent:pipeline -- runs the unattended active-task pipeline
 */
import type { AgentId } from '../core/index.js';
import { ALL_AGENT_IDS, getErrorMessage } from '../core/index.js';
import { runRoleAgent } from './roleAgent.js';
import { runPipelineSequence } from './pipeline/sequencer.js';
import { fromRegistryId } from './metadata.js';
import { clearPipelineKill, requestPipelineKill } from './pipeline/runtimeControl.js';

const VALID_AGENT_IDS = new Set<string>(ALL_AGENT_IDS);

function normalizeAgentId(value: string): AgentId | undefined {
  if (VALID_AGENT_IDS.has(value)) {
    return value as AgentId;
  }
  return fromRegistryId(value);
}

/**
 * Normalize and validate an agent ID from a CLI flag.
 * Returns the normalized ID, or `undefined` after writing an error if invalid.
 */
function requireAgentId(raw: string | undefined, flag: string): AgentId | undefined {
  if (!raw) return undefined;
  const normalized = normalizeAgentId(raw);
  if (!normalized) {
    process.stderr.write(`Error: unknown agent-id for ${flag}: "${raw}"\n`);
    process.exitCode = 1;
  }
  return normalized;
}

/** Check that a flag's value argument exists; writes error and sets exitCode if missing. */
function requireValue(args: string[], i: number, flag: string): boolean {
  if (i + 1 >= args.length) {
    process.stderr.write(`Error: ${flag} requires a value\n`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

/** Parse CLI arguments and dispatch to the appropriate subcommand. */
export async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const subcommand = args[0];

  switch (subcommand) {
    case 'run':
      await handleRun(args.slice(1));
      break;
    case 'pipeline':
      await handlePipeline(args.slice(1));
      break;
    case 'kill':
      await handleKill(args.slice(1));
      break;
    case 'clear-kill':
      await handleClearKill(args.slice(1));
      break;
    case '--help':
    case '-h':
      printUsage();
      break;
    default:
      if (subcommand) {
        process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      }
      printUsage();
      process.exitCode = 1;
      break;
  }
}

function printUsage(): void {
  process.stdout.write(
    `Usage: pnpm run agent -- [options]
       pnpm run agent:pipeline -- [options]
       pnpm run agent:kill -- [options]

Subcommands (when invoking cli.ts directly):
  run        Run a single role agent
  pipeline   Run the full pipeline sequence
  kill       Request termination of an in-flight pipeline
  clear-kill Clear a pending pipeline kill request

Options:
  --help, -h  Show this help text
`,
  );
}

async function handleRun(args: string[]): Promise<void> {
  let agentId: AgentId | undefined;
  let taskId: string | undefined;
  let dryRun = false;
  let skipWorkflowValidation = false;
  let contextPackDir: string | undefined;
  let expectRole: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent-id':
        if (!requireValue(args, i, '--agent-id')) return;
        agentId = args[++i] as AgentId;
        break;
      case '--task-id':
        if (!requireValue(args, i, '--task-id')) return;
        taskId = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--skip-workflow-check':
        skipWorkflowValidation = true;
        break;
      case '--context-pack-dir':
        if (!requireValue(args, i, '--context-pack-dir')) return;
        contextPackDir = args[++i];
        break;
      case '--expect-role':
        if (!requireValue(args, i, '--expect-role')) return;
        expectRole = args[++i];
        break;
      case '--help':
      case '-h':
        process.stdout.write(
          `Usage: agent-runner run --agent-id <id> --task-id <id> [options]\n` +
          `Options:\n` +
          `  --dry-run              Print command without launching\n` +
          `  --skip-workflow-check  Skip workflow policy check\n` +
          `  --context-pack-dir     Active context pack directory\n` +
          `  --expect-role          Verify agent ID matches this role\n`,
        );
        return;
      case '--':
        break;
      default:
        process.stderr.write(`Unknown option: ${args[i]}\n`);
        process.exitCode = 1;
        return;
    }
  }

  if (!agentId) {
    process.stderr.write('Error: --agent-id is required\n');
    process.exitCode = 1;
    return;
  }

  if (!taskId) {
    process.stderr.write('Error: --task-id is required\n');
    process.exitCode = 1;
    return;
  }

  const normalizedAgentId = requireAgentId(agentId, '--agent-id');
  if (!normalizedAgentId) return;

  const normalizedExpectRole = requireAgentId(expectRole, '--expect-role');
  if (expectRole && !normalizedExpectRole) return;

  await runRoleAgent({
    agentId: normalizedAgentId,
    taskId,
    dryRun,
    skipWorkflowValidation,
    contextPackDir,
    expectRole: normalizedExpectRole,
  });
}

async function handlePipeline(args: string[]): Promise<void> {
  let startAt: AgentId | undefined;
  let stopAfter: AgentId | undefined;
  let taskId: string | undefined;
  let autoAdvance = false;
  let skipResetOnFailure = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start-at':
        if (!requireValue(args, i, '--start-at')) return;
        startAt = args[++i] as AgentId;
        break;
      case '--stop-after':
        if (!requireValue(args, i, '--stop-after')) return;
        stopAfter = args[++i] as AgentId;
        break;
      case '--task-id':
        if (!requireValue(args, i, '--task-id')) return;
        taskId = args[++i];
        break;
      case '--auto-advance':
        autoAdvance = true;
        break;
      case '--skip-reset-on-failure':
        skipResetOnFailure = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(
          `Usage: agent-runner pipeline [--start-at <id>] [--stop-after <id>] [--task-id <id>] [--auto-advance] [--skip-reset-on-failure]\n` +
          `Defaults to the unattended active-task order (Alice -> Dalton -> Ron).\n`,
        );
        return;
      case '--':
        break;
      default:
        process.stderr.write(`Unknown option: ${args[i]}\n`);
        process.exitCode = 1;
        return;
    }
  }

  if (!taskId) {
    process.stderr.write('Error: --task-id is required for pipeline command.\n');
    process.exitCode = 1;
    return;
  }

  const normalizedStartAt = requireAgentId(startAt, '--start-at');
  if (startAt && !normalizedStartAt) return;

  const normalizedStopAfter = requireAgentId(stopAfter, '--stop-after');
  if (stopAfter && !normalizedStopAfter) return;

  await runPipelineSequence({
    taskId,
    startAt: normalizedStartAt,
    stopAfter: normalizedStopAfter,
    autoAdvance,
    skipResetOnFailure,
  });
}

async function handleKill(args: string[]): Promise<void> {
  let repoRoot: string | undefined;
  let taskId: string | undefined;
  let reason = 'operator-request';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--repo-root':
        if (!requireValue(args, i, '--repo-root')) return;
        repoRoot = args[++i];
        break;
      case '--task-id':
        if (!requireValue(args, i, '--task-id')) return;
        taskId = args[++i];
        break;
      case '--reason':
        if (!requireValue(args, i, '--reason')) return;
        reason = args[++i];
        break;
      case '--help':
      case '-h':
        process.stdout.write('Usage: agent-runner kill --task-id <id> [--repo-root <path>] [--reason <text>]\n');
        return;
      default:
        process.stderr.write(`Unknown option: ${args[i]}\n`);
        process.exitCode = 1;
        return;
    }
  }

  if (!taskId) {
    process.stderr.write('Error: --task-id is required for kill command.\n');
    process.exitCode = 1;
    return;
  }

  await requestPipelineKill(repoRoot ?? process.cwd(), taskId, reason);
  process.stdout.write('Pipeline kill requested.\n');
}

async function handleClearKill(args: string[]): Promise<void> {
  let repoRoot: string | undefined;
  let taskId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--repo-root':
        if (!requireValue(args, i, '--repo-root')) return;
        repoRoot = args[++i];
        break;
      case '--task-id':
        if (!requireValue(args, i, '--task-id')) return;
        taskId = args[++i];
        break;
      case '--help':
      case '-h':
        process.stdout.write('Usage: agent-runner clear-kill --task-id <id> [--repo-root <path>]\n');
        return;
      default:
        process.stderr.write(`Unknown option: ${args[i]}\n`);
        process.exitCode = 1;
        return;
    }
  }

  if (!taskId) {
    process.stderr.write('Error: --task-id is required for clear-kill command.\n');
    process.exitCode = 1;
    return;
  }

  const cleared = await clearPipelineKill(repoRoot ?? process.cwd(), taskId);
  process.stdout.write(cleared ? 'Cleared pipeline kill request.\n' : 'No pipeline kill request was present.\n');
}

main(process.argv).catch((err: unknown) => {
  process.stderr.write(`${getErrorMessage(err)}\n`);
  process.exitCode = 1;
});
