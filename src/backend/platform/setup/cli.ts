#!/usr/bin/env node

import { setupRepo } from './setup.js';
import {
  runCliBoundary,
  writeProtocolStderr,
  writeProtocolStdout,
} from '../core/index.js';

function usage(): void {
  writeProtocolStdout(`Usage: platform-setup [options]

Options:
  --skip-container-services  Skip starting container services
  --skip-docker              Deprecated alias for --skip-container-services
  --help, -h                 Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const skipContainerServices = args.includes('--skip-container-services')
    || args.includes('--skip-docker');

  const result = await setupRepo({ skipContainerServices });

  writeProtocolStdout(`Platform: ${result.os}\n`);
  for (const step of result.steps) {
    const icon = step.status === 'ok' ? 'ok' : step.status === 'skipped' ? 'skip' : 'FAIL';
    const msg = step.message ? ` — ${step.message}` : '';
    writeProtocolStdout(`  [${icon}] ${step.name}${msg}\n`);
  }

  const failed = result.steps.some(s => s.status === 'failed');
  if (failed) {
    writeProtocolStderr('\nSetup completed with failures.\n');
    process.exit(1);
  }

  writeProtocolStdout('\nSetup completed successfully.\n');
}

runCliBoundary('platform/setup/cli', main);
