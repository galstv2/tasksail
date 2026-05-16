import { evaluateWorkflowPolicy } from './evaluate.js';
import { MODE_CHOICES, OUTPUT_CHOICES } from './models.js';
import type { PolicyOutputFormat, PolicyValidationMode } from './types.js';
import {
  runCliBoundary,
  ValidationError,
  writeProtocolStderr,
  writeProtocolStdout,
} from '../core/index.js';

/** Modes that require --task-id (fail-closed if absent). */
const TASK_ID_REQUIRED_MODES = new Set<PolicyValidationMode>([
  'runtime',
  'pre-slice',
  'pre-closeout',
  'pre-archive',
  'queue-advance',
  'ci',
  'activation-bootstrap',
]);

interface CliOptions {
  root: string;
  mode: PolicyValidationMode;
  format: PolicyOutputFormat;
  taskId?: string;
  contextPackDir?: string;
  requestedAgentId?: string;
  enforce?: boolean;
}

function printUsage(): void {
  writeProtocolStdout(
    'Usage: workflow-policy [options]\n' +
      'Options:\n' +
      '  --root <path>                Repo root to validate (defaults to cwd)\n' +
      `  --mode <mode>                Validation mode (${MODE_CHOICES.join(', ')})\n` +
      `  --format <format>            Output format (${OUTPUT_CHOICES.join(', ')})\n` +
      '  --task-id <id>               Task ID (required for guarded modes, optional for lint)\n' +
      '  --context-pack-dir <path>    Optional active context-pack directory\n' +
      '  --requested-agent-id <id>    Optional requested agent for runtime checks\n' +
      '  --enforce                    Force fail-closed behavior\n' +
      '  --help, -h                   Show this help text\n',
  );
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new ValidationError(`${flag} requires a value`, {
      code: 'WORKFLOW_POLICY_ARG_VALUE_REQUIRED',
      category: 'user',
      context: { flag },
    });
  }
  return value;
}

function isModeChoice(value: string): value is PolicyValidationMode {
  return (MODE_CHOICES as readonly string[]).includes(value);
}

function isFormatChoice(value: string): value is PolicyOutputFormat {
  return (OUTPUT_CHOICES as readonly string[]).includes(value);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    mode: 'lint',
    format: 'text',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--root':
        options.root = requireValue(argv, i, '--root');
        i += 1;
        break;
      case '--mode': {
        const value = requireValue(argv, i, '--mode');
        if (!isModeChoice(value)) {
          throw new ValidationError(`invalid --mode: ${value}`, {
            code: 'WORKFLOW_POLICY_MODE_INVALID',
            category: 'user',
            context: { value },
          });
        }
        options.mode = value;
        i += 1;
        break;
      }
      case '--format': {
        const value = requireValue(argv, i, '--format');
        if (!isFormatChoice(value)) {
          throw new ValidationError(`invalid --format: ${value}`, {
            code: 'WORKFLOW_POLICY_FORMAT_INVALID',
            category: 'user',
            context: { value },
          });
        }
        options.format = value;
        i += 1;
        break;
      }
      case '--task-id':
        options.taskId = requireValue(argv, i, '--task-id');
        i += 1;
        break;
      case '--context-pack-dir':
        options.contextPackDir = requireValue(argv, i, '--context-pack-dir');
        i += 1;
        break;
      case '--requested-agent-id':
        options.requestedAgentId = requireValue(argv, i, '--requested-agent-id');
        i += 1;
        break;
      case '--enforce':
        options.enforce = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new ValidationError(`unknown option: ${arg}`, {
          code: 'WORKFLOW_POLICY_OPTION_UNKNOWN',
          category: 'user',
          context: { option: arg },
        });
    }
  }

  return options;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv.slice(2));

    // --task-id is required for all guarded (non-lint) modes.
    if (TASK_ID_REQUIRED_MODES.has(args.mode) && !args.taskId) {
      throw new ValidationError(
        `task-id-required: --task-id <id> is required when --mode is '${args.mode}'.`,
        {
          code: 'WORKFLOW_POLICY_TASK_ID_REQUIRED',
          category: 'user',
          context: { mode: args.mode },
        },
      );
    }

    const result = await evaluateWorkflowPolicy({
      repoRoot: args.root,
      mode: args.mode,
      taskId: args.taskId,
      format: args.format,
      contextPackDir: args.contextPackDir,
      requestedAgentId: args.requestedAgentId,
      enforce: args.enforce,
    });
    writeProtocolStdout(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeProtocolStderr(`${message}\n`);
    printUsage();
    return 1;
  }
}

runCliBoundary('platform/workflow-policy/cli', async () => {
  process.exitCode = await main(process.argv);
});
