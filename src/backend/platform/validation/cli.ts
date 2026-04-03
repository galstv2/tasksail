#!/usr/bin/env node

import { validateStructure } from './structure.js';
import { checkFileSizes } from './fileSizes.js';
import { runLocalChecks, type LocalChecksProfile } from './localChecks.js';
import { preCommitHook } from './preCommitHook.js';

const VALID_PROFILES = new Set<string>(['full', 'smoke', 'integration', 'contracts']);

function usage(): void {
  console.log(`Usage: platform-validate <command> [options]

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
      if (!result.valid) {
        for (const err of result.errors) {
          console.error(`  [FAIL] ${err}`);
        }
        console.error('\nRepository structure validation failed.');
        process.exit(1);
      }
      console.log('Repository structure validation passed.');
      break;
    }

    case 'check-sizes': {
      const result = await checkFileSizes();
      for (const w of result.warnings) {
        console.warn(`  [WARN] ${w.path}: ${w.lines} lines (baseline ${w.baseline})`);
      }
      if (result.violations.length > 0) {
        for (const v of result.violations) {
          console.error(`  [FAIL] ${v.path}: ${v.lines} lines (limit ${v.limit})`);
        }
        process.exit(1);
      }
      console.log('All files within size limits.');
      break;
    }

    case 'local-checks': {
      const options: { profile?: LocalChecksProfile; changedPath?: string; domain?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--profile' && args[i + 1]) {
          const profile = args[++i];
          if (!VALID_PROFILES.has(profile)) {
            console.error(`Unknown profile: ${profile}`);
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
        console.log(`  [${icon}] ${r.name} (${r.duration}ms)${r.error ? ': ' + r.error : ''}`);
      }
      for (const w of result.advisoryWarnings) {
        console.warn(`  [ADVISORY] ${w}`);
      }
      if (!result.passed) {
        process.exit(1);
      }
      console.log('\nAll local checks passed.');
      break;
    }

    case 'pre-commit': {
      const result = await preCommitHook();
      if (!result.passed) {
        for (const f of result.failures) {
          console.error(`  [FAIL] ${f}`);
        }
        console.error(`\nPre-commit: ${result.failures.length} check(s) failed.`);
        process.exit(1);
      }
      console.log('Pre-commit checks passed.');
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
