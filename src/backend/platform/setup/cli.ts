#!/usr/bin/env node

import { setupRepo } from './setup.js';

function usage(): void {
  console.log(`Usage: platform-setup [options]

Options:
  --skip-docker   Skip starting Docker services
  --help, -h      Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    usage();
    process.exit(0);
  }

  const skipDocker = args.includes('--skip-docker');

  const result = await setupRepo({ skipDocker });

  console.log(`Platform: ${result.os}`);
  for (const step of result.steps) {
    const icon = step.status === 'ok' ? 'ok' : step.status === 'skipped' ? 'skip' : 'FAIL';
    const msg = step.message ? ` — ${step.message}` : '';
    console.log(`  [${icon}] ${step.name}${msg}`);
  }

  const failed = result.steps.some(s => s.status === 'failed');
  if (failed) {
    console.error('\nSetup completed with failures.');
    process.exit(1);
  }

  console.log('\nSetup completed successfully.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
