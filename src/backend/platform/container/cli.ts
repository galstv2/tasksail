import { findRepoRoot } from '../core/index.js';
import { loadMcpRegistry, RUNTIME_REGISTRY_PATH } from '../mcp-registry/index.js';
import { toServiceHealthSpecs } from '../mcp-registry/healthSpecs.js';
import { createRuntimeFromConfig } from './runtime.js';
import { resolveDefaultComposeFile } from './types.js';
import { assertHealthSpecsConfigured } from './healthcheck.js';
import { requireAuthorizedActiveContextPack } from '../context-pack/active.js';
import { getPlatformConfig } from '../platform-config/get.js';
import { seedPlatformConfig } from '../platform-config/seed.js';
import { createSharedMcpBootstrapEnv, sweepLegacyPortAllocationsOnce } from './sharedMcp.js';
import { stopDirectMcp } from './directRuntimeProcess.js';
import path from 'node:path';

/**
 * Minimal CLI entry point for container-runtime operations.
 * Subcommands: healthcheck, bootstrap, seed, up, down
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand) {
    printUsage();
    process.exit(1);
  }

  const repoRoot = findRepoRoot();

  // Sync .platform-state/platform.json from config/platform.default.json
  // BEFORE anything else reads it. createRuntimeFromConfig (below) and
  // getPlatformConfig (in subcommand branches) both consume the runtime file
  // to decide the container backend and shared-MCP port; seeding here
  // guarantees those reads see the current default. The seed inside
  // bootstrapServices is preserved as a self-contained safety net for
  // direct callers of that API; on this path it becomes an idempotent no-op.
  const platformSeed = await seedPlatformConfig(repoRoot);
  if (platformSeed.action === 'failed') {
    const messages = platformSeed.errors.map(
      (e) => `  ${e.field}: ${e.message} (${e.fix})`,
    );
    console.error(`Platform config validation failed:\n${messages.join('\n')}`);
    process.exit(1);
  }

  const runtime = await createRuntimeFromConfig(repoRoot);

  switch (subcommand) {
    case 'healthcheck': {
      const registryPath = path.join(repoRoot, RUNTIME_REGISTRY_PATH);
      const registryResult = await loadMcpRegistry(registryPath);
      if (!registryResult.ok) {
        for (const e of registryResult.errors) {
          console.error(`${e.field}: ${e.message} (${e.fix})`);
        }
        process.exit(1);
      }
      const healthSpecs = toServiceHealthSpecs(registryResult.registry);
      assertHealthSpecsConfigured(healthSpecs, 'healthcheck');
      const results = await runtime.healthcheck(healthSpecs);
      let failed = false;
      for (const r of results) {
        const status = r.healthy ? '[ok]' : '[fail]';
        console.log(`${status} ${r.service} (${r.attempts} attempts)`);
        if (r.error) {
          console.error(`  ${r.error}`);
        }
        if (!r.healthy) {
          failed = true;
        }
      }
      if (failed) {
        console.error('One or more container endpoints failed health checks.');
        process.exit(1);
      }
      console.log('All configured container endpoints passed health checks.');
      break;
    }

    case 'bootstrap': {
      const buildFlag = args.includes('--build');
      const composeFileArg = extractArg(args, '--compose-file');
      const platformConfig = await getPlatformConfig(repoRoot);

      await sweepLegacyPortAllocationsOnce(repoRoot);
      await runtime.bootstrap({
        repoRoot,
        composeFile: composeFileArg,
        build: buildFlag,
        env: createSharedMcpBootstrapEnv(platformConfig.mcp_port),
      });
      console.log('Bootstrap complete.');
      break;
    }

    case 'seed': {
      // §3.2: resolve context pack dir via the sidecar policy layer when
      // TASKSAIL_TASK_ID is set; fall back to the singleton helper otherwise.
      // The raw ACTIVE_CONTEXT_PACK_DIR env read is removed from the task-launch path.
      let contextPackDir = extractArg(args, '--context-pack-dir');
      if (!contextPackDir) {
        const taskId = process.env['TASKSAIL_TASK_ID'];
        try {
          contextPackDir = await requireAuthorizedActiveContextPack({ taskId, repoRoot });
        } catch {
          contextPackDir = undefined;
        }
      }

      if (!contextPackDir) {
        console.error(
          'Context pack directory required. Pass --context-pack-dir, set TASKSAIL_TASK_ID, or activate a context pack.',
        );
        process.exit(1);
      }

      await runtime.seedIndex({
        repoRoot,
        contextPackDir,
        manifest: extractArg(args, '--manifest'),
        planFile: extractArg(args, '--plan-file'),
        planMode: extractArg(args, '--plan-mode') as
          | 'prefer-plan'
          | 'require-plan'
          | 'manifest-only'
          | undefined,
        writePlan: !args.includes('--no-write-report'),
      });
      console.log('Seed complete.');
      break;
    }

    case 'up': {
      const composeFileRel = requireComposeRuntime(runtime);
      const composeFile = path.resolve(repoRoot, composeFileRel);
      await runtime.composeUp({
        composeFile,
        detach: true,
        build: args.includes('--build'),
      });
      console.log('Services started.');
      break;
    }

    case 'down': {
      // Always stop a direct-mode daemon if its PID file exists. This handles
      // the mode-flip case: if the user bootstrapped under "direct" and then
      // changed container_runtime in platform.json, the configured runtime's
      // composeDown wouldn't know about the orphaned host-process daemon.
      // stopDirectMcp is repo-scoped (PID file under .platform-state) and
      // idempotent (no-op when the PID file is absent), so it's safe to call
      // here regardless of the configured backend.
      await stopDirectMcp(repoRoot);
      if (runtime.requiresComposeFile) {
        const composeFileRel = requireComposeRuntime(runtime);
        const composeFile = path.resolve(repoRoot, composeFileRel);
        await runtime.composeDown({ composeFile });
      } else {
        await runtime.composeDown({ env: { TASKSAIL_REPO_ROOT: repoRoot } });
      }
      console.log('Services stopped.');
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

function requireComposeRuntime(runtime: Awaited<ReturnType<typeof createRuntimeFromConfig>>): string {
  const composeFile = resolveDefaultComposeFile(runtime.backend);
  if (!runtime.requiresComposeFile || composeFile === undefined) {
    process.stderr.write(
      `This command requires a compose-bound runtime; container_runtime is "${runtime.backend}".\n`,
    );
    process.exit(1);
  }
  return composeFile;
}

function printUsage(): void {
  console.log('Usage: container-runtime <healthcheck|bootstrap|seed|up|down> [options]');
}

function extractArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
