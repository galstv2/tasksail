#!/usr/bin/env node

import { validateStructure } from './structure.js';
import { checkFileSizes } from './fileSizes.js';
import { checkTestCountFloor } from './testCountFloor.js';
import { checkLoggingDiscipline } from './loggingDiscipline.js';
import {
  checkCommentDiscipline,
  formatCommentDisciplineText,
  type CommentDisciplineMode,
} from './commentDiscipline.js';
import {
  checkOpenSourceReadiness,
  formatOpenSourceReadinessText,
} from './openSourceReadiness.js';
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
  check-test-floor Check per-module test-count floors
  check-comments   Check comment discipline
  check-open-source-readiness
                  Check public MIT source and desktop package readiness
  local-checks     Run the full local validation gate
  pre-commit       Run pre-commit hook checks

Options for check-comments:
  --mode <mode>           report | changed | full
  --base-ref <ref>        Base ref for changed mode
  --head-ref <ref>        Head ref for changed mode
  --staged                Read staged blobs and cached diff ranges
  --format <format>       text | json

Options for local-checks:
  --profile <profile>       full | smoke | integration | contracts
  --changed-path <path>     Limit checks to changed path
  --domain <domain>         Test a specific domain
  --comments                Run comment discipline explicitly
  --comment-mode <mode>     report | changed | full
  --base-ref <ref>          Base ref for comment changed mode
  --head-ref <ref>          Head ref for comment changed mode
  --staged                  Read staged blobs for comment discipline
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    writeProtocolStderr(`${flag} requires a value\n`);
    process.exit(1);
  }
  return value;
}

function parseCommentMode(raw: string): CommentDisciplineMode {
  if (raw === 'report' || raw === 'changed' || raw === 'full') {
    return raw;
  }
  writeProtocolStderr(`Unknown comment discipline mode: ${raw}\n`);
  process.exit(1);
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

    case 'check-test-floor': {
      const result = await checkTestCountFloor();
      if (result.violations.length > 0) {
        for (const v of result.violations) {
          writeProtocolStderr(`  [FAIL] ${v.module}: ${v.count} tests (floor ${v.floor})\n`);
        }
        writeProtocolStderr('\nTest-count floor check failed — a module dropped below its recorded floor.\nIf this reduction is intentional, lower the floor in src/backend/platform/validation/data/test-count-floor.txt.\n');
        process.exit(1);
      }
      writeProtocolStdout(`All ${result.modules.length} modules at or above their test-count floor.\n`);
      break;
    }

    case 'local-checks': {
      const options: {
        profile?: LocalChecksProfile;
        changedPath?: string;
        domain?: string;
        comments?: boolean;
        commentMode?: CommentDisciplineMode;
        baseRef?: string;
        headRef?: string;
        staged?: boolean;
      } = {};
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
        } else if (args[i] === '--comments' || args[i] === '--comment-discipline') {
          options.comments = true;
        } else if (args[i] === '--comment-mode') {
          options.commentMode = parseCommentMode(requireValue(args, i, args[i]!));
          i++;
        } else if (args[i] === '--base-ref') {
          options.baseRef = requireValue(args, i, args[i]!);
          i++;
        } else if (args[i] === '--head-ref') {
          options.headRef = requireValue(args, i, args[i]!);
          i++;
        } else if (args[i] === '--staged') {
          options.staged = true;
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

    case 'check-comments': {
      let mode: CommentDisciplineMode = 'report';
      let baseRef: string | undefined;
      let headRef: string | undefined;
      let staged = false;
      let format: 'text' | 'json' = 'text';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--mode') {
          mode = parseCommentMode(requireValue(args, i, args[i]!));
          i++;
        } else if (args[i] === '--base-ref') {
          baseRef = requireValue(args, i, args[i]!);
          i++;
        } else if (args[i] === '--head-ref') {
          headRef = requireValue(args, i, args[i]!);
          i++;
        } else if (args[i] === '--staged') {
          staged = true;
        } else if (args[i] === '--format') {
          const value = requireValue(args, i, args[i]!);
          if (value !== 'text' && value !== 'json') {
            writeProtocolStderr(`Unknown check-comments format: ${value}\n`);
            process.exit(1);
          }
          format = value;
          i++;
        }
      }
      const result = await checkCommentDiscipline({ mode, baseRef, headRef, staged });
      if (format === 'json') {
        writeProtocolStdout(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        writeProtocolStdout(formatCommentDisciplineText(result));
      }
      if (!result.valid) {
        process.exit(1);
      }
      break;
    }

    case 'check-open-source-readiness': {
      const result = await checkOpenSourceReadiness();
      writeProtocolStdout(formatOpenSourceReadinessText(result));
      if (!result.valid) {
        process.exit(1);
      }
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
