/**
 * CLI entry point for the external MCP registry module.
 *
 * Called by the Python bridge via tsx to validate and load the external
 * MCP registry without reimplementing validation in Python.
 *
 * Usage:
 *   npx tsx src/backend/platform/external-mcp-registry/cli.ts validate --root <repo-root>
 *
 * Outputs JSON to stdout:
 *   Success: { "ok": true, "registry": { ... } }
 *   Failure: { "ok": false, "errors": [ ... ] }
 *
 * Exit code 0 on success, 1 on validation failure, 2 on unexpected error.
 */
import path from 'node:path';

import {
  createLogger,
  runCliBoundary,
  ValidationError,
  writeProtocolStderr,
  writeProtocolStdout,
} from '../core/index.js';
import { loadExternalMcpRegistry, RUNTIME_REGISTRY_PATH } from './load.js';
import { seedExternalMcpRegistry } from './seed.js';

const log = createLogger('platform/external-mcp-registry/cli');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'validate' && command !== 'seed') {
    throw new ValidationError('Usage: cli.ts <validate|seed> --root <repo-root>', {
      code: 'EXTERNAL_MCP_COMMAND_INVALID',
      category: 'user',
      context: { command },
    });
  }

  const rootIdx = args.indexOf('--root');
  if (rootIdx === -1 || rootIdx + 1 >= args.length) {
    throw new ValidationError('Missing required --root argument.', {
      code: 'EXTERNAL_MCP_ROOT_REQUIRED',
      category: 'user',
    });
  }
  const repoRoot = args[rootIdx + 1];

  if (command === 'seed') {
    const result = await seedExternalMcpRegistry(repoRoot);
    writeProtocolStdout(JSON.stringify(result) + '\n');
    process.exit(result.action === 'failed' ? 1 : 0);
  }

  // validate — load runtime registry only (no fallback to default).
  // The runtime file is the authoritative source after seeding.
  // If it is missing, the caller should seed first.
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);
  const result = await loadExternalMcpRegistry(runtimePath);

  writeProtocolStdout(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

runCliBoundary('platform/external-mcp-registry/cli', () => main().catch((e: unknown) => {
  log.error('cli.crash', e);
  writeProtocolStderr(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
}));
