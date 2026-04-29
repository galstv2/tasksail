import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findRepoRoot } from '../core/index.js';
import { activateContextPack } from './activate.js';
import { rebuildAgentMirror } from './rebuildAgentMirror.js';
import { switchContextPackWorkspace } from './switch.js';
import type { SwitchMode } from './types.js';

const USAGE = `Usage: context-pack <command> [options]

Commands:
  activate         Validate and activate a context pack
  switch           Preview, apply, or clear workspace folders
  rebuild-mirror   Rebuild AgentWorkSpace/qmd/context-packs/<pack>/ from canonical

Global options:
  --context-pack-dir <path>  Path to the context pack directory
  --dry-run                  Print what would happen without writing
  --help                     Show this help text
`;

function printUsage(): void {
  process.stdout.write(USAGE);
}

function parseArgs(argv: string[]): {
  command: string;
  contextPackDir: string;
  dryRun: boolean;
  mode: SwitchMode;
  bootstrapRepoRoot?: string;
  help: boolean;
} {
  let command = '';
  let contextPackDir = '';
  let dryRun = false;
  let mode: SwitchMode = 'preview';
  let bootstrapRepoRoot: string | undefined;
  let help = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case 'activate':
      case 'switch':
      case 'rebuild-mirror':
        command = arg;
        break;
      case '--context-pack-dir':
        contextPackDir = argv[++i] ?? '';
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--preview':
        mode = 'preview';
        break;
      case '--apply':
        mode = 'apply';
        break;
      case '--clear':
        mode = 'clear';
        break;
      case '--bootstrap-repo-root':
        if (++i >= argv.length) break;
        bootstrapRepoRoot = argv[i];
        break;
      case '--help':
      case '-h':
        help = true;
        break;
      default:
        break;
    }
    i++;
  }

  return { command, contextPackDir, dryRun, mode, bootstrapRepoRoot, help };
}

/**
 * CLI entry point. Parses process.argv and dispatches to the programmatic API.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (args.help) {
    printUsage();
    return;
  }

  if (!args.command) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  findRepoRoot();

  switch (args.command) {
    case 'activate': {
      if (!args.contextPackDir) {
        process.stderr.write('Error: --context-pack-dir is required\n');
        process.exitCode = 1;
        return;
      }
      const result = await activateContextPack({
        contextPackDir: args.contextPackDir,
        bootstrapRepoRoot: args.bootstrapRepoRoot,
        dryRun: args.dryRun,
      });
      if (!result.validation.valid) {
        for (const err of result.validation.errors) {
          process.stderr.write(`Error: ${err}\n`);
        }
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        JSON.stringify({ activated: true }, null, 2) + '\n',
      );
      break;
    }
    case 'switch': {
      if (args.mode !== 'clear' && !args.contextPackDir) {
        process.stderr.write(
          'Error: --context-pack-dir is required for preview and apply\n',
        );
        process.exitCode = 1;
        return;
      }
      const result = await switchContextPackWorkspace({
        contextPackDir: args.contextPackDir,
        mode: args.mode,
      });
      process.stdout.write(result.output + '\n');
      break;
    }
    case 'rebuild-mirror': {
      if (!args.contextPackDir) {
        process.stderr.write('Error: --context-pack-dir is required\n');
        process.exitCode = 1;
        return;
      }
      const repoRoot = findRepoRoot();
      const contextPackDir = path.isAbsolute(args.contextPackDir)
        ? args.contextPackDir
        : path.resolve(repoRoot, args.contextPackDir);
      const result = await rebuildAgentMirror(repoRoot, contextPackDir);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      break;
    }
    default:
      process.stderr.write(`Unknown command: ${args.command}\n`);
      printUsage();
      process.exitCode = 1;
  }
}

const isCliEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isCliEntrypoint) {
  void main().catch((err: unknown) => {
    process.stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
