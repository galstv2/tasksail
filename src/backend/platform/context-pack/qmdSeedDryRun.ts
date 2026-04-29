import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../core/index.js';
import { planQmdSeeding } from './pythonHelpers.js';

const USAGE = `Usage: qmd-seed-dry-run --context-pack-dir <path> [options]

Options:
  --context-pack-dir <path>  Path to the context pack directory
  --manifest <path>          Path to the QMD manifest
  --plan-file <path>         Path to write the seed plan
  --write-plan               Write the seed plan to --plan-file
  --quiet                    Reduce helper output
  --help, -h                 Show this help text
`;

interface Args {
  contextPackDir: string;
  manifestPath?: string;
  planFile?: string;
  writePlan: boolean;
  quiet: boolean;
  help: boolean;
}

function readRequiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    contextPackDir: '',
    writePlan: false,
    quiet: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--context-pack-dir':
        if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) {
          throw new Error(`${arg} requires a value`);
        }
        args.contextPackDir = argv[i + 1];
        i += 2;
        break;
      case '--manifest':
        args.manifestPath = readRequiredValue(argv, i, arg);
        i += 2;
        break;
      case '--plan-file':
        args.planFile = readRequiredValue(argv, i, arg);
        i += 2;
        break;
      case '--write-plan':
        args.writePlan = true;
        i++;
        break;
      case '--quiet':
        args.quiet = true;
        i++;
        break;
      case '--help':
      case '-h':
        args.help = true;
        i++;
        break;
      case '--':
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (!args.contextPackDir) {
    process.stderr.write('Error: --context-pack-dir is required\n');
    process.exitCode = 1;
    return;
  }

  try {
    const repoRoot = findRepoRoot();
    const result = await planQmdSeeding({
      repoRoot,
      contextPackDir: args.contextPackDir,
      manifestPath: args.manifestPath,
      planFile: args.planFile,
      writePlan: args.writePlan,
      quiet: args.quiet,
    });
    process.stdout.write(result.stdout);
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  } catch (err) {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  }
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  void main();
}
