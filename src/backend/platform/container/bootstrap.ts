import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureEnvFile } from '../core/index.js';
import { toServiceHealthSpecs } from '../mcp-registry/healthSpecs.js';
import { getEnabledComposeServices } from '../mcp-registry/composeMetadata.js';
import { seedMcpRegistry } from '../mcp-registry/seed.js';
import type { ContainerRuntime, BootstrapOptions } from './types.js';
import { DEFAULT_COMPOSE_FILE } from './types.js';
import { buildComposeCommand, validateComposeConfig, execCommand } from './compose.js';
import { assertHealthSpecsConfigured } from './healthcheck.js';

/**
 * Bootstrap container services: seed registry, validate compose config,
 * ensure .env, start services, and verify health using registry-derived specs.
 */
export async function bootstrapServices(
  runtime: ContainerRuntime,
  options: BootstrapOptions,
): Promise<void> {
  const composeFile = options.composeFile
    ? path.resolve(options.repoRoot, options.composeFile)
    : path.resolve(options.repoRoot, DEFAULT_COMPOSE_FILE);

  if (!existsSync(composeFile)) {
    throw new Error(`Compose file not found at ${composeFile}`);
  }

  // Ensure .env and seed registry in parallel — they are independent
  const [, seedResult] = await Promise.all([
    ensureEnvFile(options.repoRoot),
    seedMcpRegistry(options.repoRoot),
  ]);

  if (seedResult.action === 'failed') {
    const messages = seedResult.errors.map(
      (e) => `  ${e.field}: ${e.message} (${e.fix})`,
    );
    throw new Error(
      `MCP registry validation failed:\n${messages.join('\n')}`,
    );
  }

  // Use registry directly from seed result — no redundant disk read
  const healthSpecs = toServiceHealthSpecs(seedResult.registry);
  assertHealthSpecsConfigured(healthSpecs, 'bootstrap');

  // Verify enabled registry services have matching compose services.
  // Uses buildComposeCommand — the same compose invocation path as
  // validateComposeConfig and runtime.composeUp/Down.
  await verifyRegistryComposeConsistency(
    seedResult.registry,
    composeFile,
    runtime.backend,
  );

  // Validate compose configuration
  await validateComposeConfig(composeFile, runtime.backend);

  // Start services
  await runtime.composeUp({
    composeFile,
    detach: true,
    build: options.build,
  });

  // Run health checks
  const results = await runtime.healthcheck(healthSpecs);
  const failed = results.filter((r) => !r.healthy);

  if (failed.length > 0) {
    const names = failed.map((f) => f.service).join(', ');
    await runtime.composeDown({ composeFile });
    throw new Error(`Health check failed for: ${names}`);
  }
}

/**
 * Verify that every enabled registry service has a matching compose
 * service name. Fail if an enabled registry service is missing from
 * compose. Log a warning for compose services not in the registry.
 *
 * Uses buildComposeCommand to construct the compose invocation,
 * ensuring the same command path as validateComposeConfig and
 * runtime.composeUp/Down.
 */
async function verifyRegistryComposeConsistency(
  registry: import('../mcp-registry/types.js').McpRegistry,
  composeFile: string,
  backend: import('../core/types.js').ContainerBackend,
): Promise<void> {
  // Build compose config command using the same path as all other compose calls
  const cmd = buildComposeCommand(backend, 'config', { composeFile });
  // Append --services to list service names
  cmd.push('--services');

  let composeServiceNames: string[];
  try {
    const { stdout } = await execCommand(cmd[0], cmd.slice(1));
    composeServiceNames = stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    // If compose config --services fails, skip consistency check
    // (validateComposeConfig will catch the real error)
    return;
  }

  const enabledServices = getEnabledComposeServices(registry);
  const composeSet = new Set(composeServiceNames);

  // Fail if enabled registry service is missing from compose
  const missingFromCompose = enabledServices
    .filter((svc) => !composeSet.has(svc.compose.serviceName));

  if (missingFromCompose.length > 0) {
    const names = missingFromCompose.map((s) => s.compose.serviceName).join(', ');
    throw new Error(
      `Enabled registry service(s) not found in compose file: ${names}. ` +
      'Ensure the compose file includes all enabled services from the MCP registry.',
    );
  }

  // Warn for compose services not in registry (non-MCP infrastructure)
  const registryServiceNames = new Set(enabledServices.map((s) => s.compose.serviceName));
  const extraCompose = composeServiceNames.filter((n) => !registryServiceNames.has(n));
  if (extraCompose.length > 0) {
    process.stderr.write(
      `Note: compose service(s) not in MCP registry (may be non-MCP infrastructure): ${extraCompose.join(', ')}\n`,
    );
  }
}
