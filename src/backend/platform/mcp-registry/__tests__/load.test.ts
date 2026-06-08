import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateRegistry, loadMcpRegistry, validateVolumePath } from '../load.js';
import type { McpRegistry, McpRegistryValidationError } from '../types.js';
import { ALLOWED_ENV_FILE_REFS } from '../types.js';
import { toServiceHealthSpecs } from '../healthSpecs.js';
import { getEnabledComposeServices } from '../composeMetadata.js';

const DEFAULT_REGISTRY_PATH = path.resolve(
  __dirname, '..', '..', '..', '..', '..', 'config', 'mcp-registry.default.json',
);

function loadDefaultRegistryJson(): unknown {
  return JSON.parse(readFileSync(DEFAULT_REGISTRY_PATH, 'utf-8'));
}

function validRegistry(): Record<string, unknown> {
  return {
    schema_version: 1,
    services: [
      {
        id: 'test-svc',
        displayName: 'Test Service',
        kind: 'container-http',
        enabled: true,
        builtin: true,
        compose: {
          serviceName: 'test-svc',
          containerName: 'test-svc',
          image: 'test:local',
          dockerfile: 'docker/test/Dockerfile',
          buildContext: '.',
          hostBind: '127.0.0.1',
          hostPort: 9000,
          containerPort: 9000,
          envFileRefs: ['.env'],
          environment: { TEST_HOST: '0.0.0.0' },
          volumes: [
            { host: '.', container: '/workspace', mode: 'ro' },
          ],
          memoryLimit: '256M',
          cpuLimit: '0.5',
          stopGracePeriod: '10s',
        },
        health: {
          url: 'http://localhost:9000/health',
          maxRetries: 5,
          retryIntervalMs: 1000,
        },
      },
    ],
  };
}

describe('default registry (config/mcp-registry.default.json)', () => {
  it('parses and validates successfully', () => {
    const data = loadDefaultRegistryJson();
    const result = validateRegistry(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry.schema_version).toBe(1);
      expect(result.registry.services).toHaveLength(1);
      expect(result.registry.services[0].id).toBe('repo-context-mcp');
    }
  });

  it('contains only repo-context-mcp', () => {
    const data = loadDefaultRegistryJson();
    const result = validateRegistry(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.registry.services.map((s) => s.id);
      expect(ids).toEqual(['repo-context-mcp']);
    }
  });

  it('health spec matches DEFAULT_SERVICES contract', () => {
    const data = loadDefaultRegistryJson() as McpRegistry;
    const specs = toServiceHealthSpecs(data);
    expect(specs).toEqual([{
      name: 'repo-context-mcp',
      url: 'http://127.0.0.1:8811/health',
      maxRetries: 10,
      retryIntervalMs: 2000,
    }]);
  });

  it('produces compose metadata for repo-context-mcp', () => {
    const data = loadDefaultRegistryJson() as McpRegistry;
    const services = getEnabledComposeServices(data);
    expect(services).toHaveLength(1);
    expect(services[0].id).toBe('repo-context-mcp');
    expect(services[0].compose.hostPort).toBe(8811);
    expect(services[0].compose.hostBind).toBe('127.0.0.1');
  });
});

describe('schema version validation', () => {
  it('rejects missing schema_version', () => {
    const data = validRegistry();
    delete data['schema_version'];
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'schema_version')).toBe(true);
    }
  });

  it('rejects non-integer schema_version', () => {
    const data = validRegistry();
    data['schema_version'] = 1.5;
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
  });

  it('rejects schema_version too high with "update platform tooling" guidance', () => {
    const data = validRegistry();
    data['schema_version'] = 999;
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const versionError = result.errors.find((e) => e.field === 'schema_version');
      expect(versionError).toBeDefined();
      expect(versionError!.message).toContain('newer than supported');
      expect(versionError!.fix).toContain('Update your platform tooling');
    }
  });

  it('rejects schema_version too low with "re-seed registry" guidance', () => {
    const data = validRegistry();
    data['schema_version'] = 0;
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'schema_version')).toBe(true);
    }
  });
});

describe('required field validation', () => {
  it('rejects missing services array', () => {
    const data = { schema_version: 1 };
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'services')).toBe(true);
    }
  });

  it('rejects non-object root', () => {
    const result = validateRegistry('not an object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].field).toBe('(root)');
    }
  });

  it('rejects service entry missing id', () => {
    const data = validRegistry();
    delete (data['services'] as Record<string, unknown>[])[0]['id'];
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'services[0].id')).toBe(true);
    }
  });

  it('rejects whitespace-only id', () => {
    const data = validRegistry();
    (data['services'] as Record<string, unknown>[])[0]['id'] = '   ';
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'services[0].id')).toBe(true);
    }
  });

  it('rejects service entry missing health', () => {
    const data = validRegistry();
    delete (data['services'] as Record<string, unknown>[])[0]['health'];
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'services[0].health')).toBe(true);
    }
  });
});

describe('duplicate ID validation', () => {
  it('rejects duplicate service IDs', () => {
    const data = validRegistry();
    const services = data['services'] as Record<string, unknown>[];
    services.push({ ...services[0] });
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('Duplicate service ID'))).toBe(true);
    }
  });
});

describe('envFileRefs validation', () => {
  it.each([...ALLOWED_ENV_FILE_REFS] as const)(
    'accepts allowed ref: %s',
    (ref) => {
      const data = validRegistry();
      (data['services'] as Record<string, unknown>[])[0]['compose'] = {
        ...((data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>),
        envFileRefs: [ref],
      };
      const result = validateRegistry(data);
      expect(result.ok).toBe(true);
    },
  );

  it.each(['.env.staging', '.env.production', '../.env', '/etc/env', ''] as const)(
    'rejects disallowed ref: %s',
    (ref) => {
      const data = validRegistry();
      (data['services'] as Record<string, unknown>[])[0]['compose'] = {
        ...((data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>),
        envFileRefs: [ref],
      };
      const result = validateRegistry(data);
      expect(result.ok).toBe(false);
    },
  );
});

describe('volume path variable reference validation', () => {
  it('accepts valid ${VAR:-default} reference without resolving it', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR:-AgentWorkSpace/qmd}', 'test.host', errors);
    expect(errors).toHaveLength(0);
  });

  it('accepts ${VAR:-default}/suffix pattern', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${HOST_DIR:-data}/subdir', 'test.host', errors);
    expect(errors).toHaveLength(0);
  });

  it('accepts plain repo-relative path', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('AgentWorkSpace/dropbox', 'test.host', errors);
    expect(errors).toHaveLength(0);
  });

  it('accepts dot path', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('.', 'test.host', errors);
    expect(errors).toHaveLength(0);
  });

  it('rejects unclosed brace', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR:-path', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Malformed variable reference');
  });

  it('rejects nested variable reference', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${A:-${B:-c}}', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Malformed variable reference');
  });

  it('rejects ${VAR} without default (no :- syntax)', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR}', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Malformed variable reference');
  });

  it('rejects variable reference with path-escaping default', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR:-../../etc/passwd}', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('escapes the repository root');
  });

  it('rejects absolute path', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('/etc/passwd', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('escapes the repository root');
  });

  it('rejects .. escape in plain path', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('../outside', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('escapes the repository root');
  });

  it('rejects empty default value in variable reference', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR:-}', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('empty or blank default');
  });

  it('rejects whitespace-only default value in variable reference', () => {
    const errors: McpRegistryValidationError[] = [];
    validateVolumePath('${MY_VAR:-   }', 'test.host', errors);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('empty or blank default');
  });
});

describe('buildContext path validation', () => {
  it('accepts buildContext that resolves to repo root', () => {
    // runtime/docker/repo-context-mcp/Dockerfile + ../../.. = .
    const data = validRegistry();
    const compose = (data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>;
    compose['dockerfile'] = 'runtime/docker/repo-context-mcp/Dockerfile';
    compose['buildContext'] = '../../..';
    const result = validateRegistry(data);
    expect(result.ok).toBe(true);
  });

  it('rejects absolute buildContext', () => {
    const data = validRegistry();
    const compose = (data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>;
    compose['dockerfile'] = 'runtime/docker/repo-context-mcp/Dockerfile';
    compose['buildContext'] = '/etc';
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field.includes('buildContext') && e.message.includes('absolute'))).toBe(true);
    }
  });

  it('rejects buildContext that escapes repo root', () => {
    const data = validRegistry();
    const compose = (data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>;
    compose['dockerfile'] = 'runtime/docker/repo-context-mcp/Dockerfile';
    compose['buildContext'] = '../../../..';
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field.includes('buildContext'))).toBe(true);
    }
  });
});

describe('static environment validation', () => {
  it('rejects variable references in static environment values', () => {
    const data = validRegistry();
    (data['services'] as Record<string, unknown>[])[0]['compose'] = {
      ...((data['services'] as Record<string, unknown>[])[0]['compose'] as Record<string, unknown>),
      environment: { PMD_KEY: '${SOME_VAR:-default}' },
    };
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('variable references'))).toBe(true);
    }
  });
});

describe('kind validation', () => {
  it('rejects unsupported kind', () => {
    const data = validRegistry();
    (data['services'] as Record<string, unknown>[])[0]['kind'] = 'stdio';
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes('Unsupported kind'))).toBe(true);
    }
  });
});

describe('validation error structure', () => {
  it('includes field path and fix guidance', () => {
    const data = validRegistry();
    delete (data['services'] as Record<string, unknown>[])[0]['id'];
    const result = validateRegistry(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.errors[0];
      expect(error.field).toMatch(/^services\[0\]/);
      expect(error.message).toBeTruthy();
      expect(error.fix).toBeTruthy();
    }
  });
});

describe('loadMcpRegistry', () => {
  it('returns error for non-existent file', async () => {
    const result = await loadMcpRegistry('/nonexistent/path/registry.json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].message).toContain('not found');
      expect(result.errors[0].fix).toContain('pnpm run setup');
    }
  });

  it('loads and validates the default registry file', async () => {
    const result = await loadMcpRegistry(DEFAULT_REGISTRY_PATH);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.registry.services[0].id).toBe('repo-context-mcp');
      expect(result.registry.services[0].health.url).toBe('http://127.0.0.1:8811/health');
    }
  });
});
