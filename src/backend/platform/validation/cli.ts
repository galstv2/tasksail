#!/usr/bin/env node

import { validateStructure } from './structure.js';
import { checkFileSizes } from './fileSizes.js';
import { checkLoggingDiscipline } from './loggingDiscipline.js';
import {
  runLocalChecks,
  runMarkdownContractValidation,
  type LocalChecksProfile,
} from './localChecks.js';
import { preCommitHook } from './preCommitHook.js';
import {
  findRepoRoot,
  runCliBoundary,
  writeProtocolStderr,
  writeProtocolStdout,
} from '../core/index.js';

const VALID_PROFILES = new Set<string>(['full', 'smoke', 'integration', 'contracts']);

function usage(): void {
  writeProtocolStdout(`Usage: platform-validate <command> [options]

Commands:
  validate         Validate repository structure
  check-sizes      Check file size limits
  local-checks     Run the full local validation gate
  pre-commit       Run pre-commit hook checks

Options for local-checks:
  --profile <profile>       full | smoke | integration | contracts
  --changed-path <path>     Limit checks to changed path
  --domain <domain>         Test a specific domain
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  switch (command) {
    case 'validate': {
      const result = await validateStructure();
      const loggingResult = await checkLoggingDiscipline();
      const errors = [...result.errors, ...loggingResult.errors];
      if (errors.length > 0) {
        for (const err of errors) {
          writeProtocolStderr(`  [FAIL] ${err}\n`);
        }
        writeProtocolStderr('\nRepository validation failed.\n');
        process.exit(1);
      }
      const repoRoot = await findRepoRoot();
      await runMarkdownContractValidation(repoRoot);
      writeProtocolStdout('Repository structure, logging discipline, and markdown contract validation passed.\n');
      break;
    }

    case 'check-sizes': {
      const result = await checkFileSizes();
      for (const w of result.warnings) {
        writeProtocolStderr(`  [WARN] ${w.path}: ${w.lines} lines (baseline ${w.baseline})\n`);
      }
      if (result.violations.length > 0) {
        for (const v of result.violations) {
          writeProtocolStderr(`  [FAIL] ${v.path}: ${v.lines} lines (limit ${v.limit})\n`);
        }
        process.exit(1);
      }
      writeProtocolStdout('All files within size limits.\n');
      break;
    }

    case 'local-checks': {
      const options: { profile?: LocalChecksProfile; changedPath?: string; domain?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--profile' && args[i + 1]) {
          const profile = args[++i];
          if (!VALID_PROFILES.has(profile)) {
            writeProtocolStderr(`Unknown profile: ${profile}\n`);
            process.exit(1);
          }
          options.profile = profile as LocalChecksProfile;
        } else if (args[i] === '--changed-path' && args[i + 1]) {
          options.changedPath = args[++i];
        } else if (args[i] === '--domain' && args[i + 1]) {
          options.domain = args[++i];
        }
      }
      const result = await runLocalChecks(options);
      for (const r of result.results) {
        const icon = r.passed ? 'PASS' : 'FAIL';
        writeProtocolStdout(`  [${icon}] ${r.name} (${r.duration}ms)${r.error ? ': ' + r.error : ''}\n`);
      }
      for (const w of result.advisoryWarnings) {
        writeProtocolStderr(`  [ADVISORY] ${w}\n`);
      }
      if (!result.passed) {
        process.exit(1);
      }
      writeProtocolStdout('\nAll local checks passed.\n');
      break;
    }

    case 'pre-commit': {
      const result = await preCommitHook();
      if (!result.passed) {
        for (const f of result.failures) {
          writeProtocolStderr(`  [FAIL] ${f}\n`);
        }
        writeProtocolStderr(`\nPre-commit: ${result.failures.length} check(s) failed.\n`);
        process.exit(1);
      }
      writeProtocolStdout('Pre-commit checks passed.\n');
      break;
    }

    default:
      writeProtocolStderr(`Unknown command: ${command}\n`);
      usage();
      process.exit(1);
  }
}

runCliBoundary('platform/validation/cli', main);
