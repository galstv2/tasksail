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

import { loadExternalMcpRegistry, RUNTIME_REGISTRY_PATH } from './load.js';
import { seedExternalMcpRegistry } from './seed.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'validate' && command !== 'seed') {
    process.stderr.write('Usage: cli.ts <validate|seed> --root <repo-root>\n');
    process.exit(2);
  }

  const rootIdx = args.indexOf('--root');
  if (rootIdx === -1 || rootIdx + 1 >= args.length) {
    process.stderr.write('Missing required --root argument.\n');
    process.exit(2);
  }
  const repoRoot = args[rootIdx + 1];

  if (command === 'seed') {
    const result = await seedExternalMcpRegistry(repoRoot);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.action === 'failed' ? 1 : 0);
  }

  // validate — load runtime registry only (no fallback to default).
  // The runtime file is the authoritative source after seeding.
  // If it is missing, the caller should seed first.
  const runtimePath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);
  const result = await loadExternalMcpRegistry(runtimePath);

  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.ok ? 0 : 1);
}

main().catch((e: unknown) => {
  process.stderr.write(`Unexpected error: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
