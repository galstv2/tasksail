import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createAgentConfigHandlers } from './agentConfigHandlers';
import { createAgentExtensionCatalogHandlers } from './agentExtensionCatalog';

const mockListAgentExtensions = vi.fn();
const mockAddAgentExtension = vi.fn();
const mockReseedAgentExtension = vi.fn();
const mockDeleteAgentExtension = vi.fn();
const mockLoadAgentLaunchExtensionAssignments = vi.fn();
const mockSaveAgentLaunchExtensionAssignments = vi.fn();

vi.mock('../../../backend/platform/agent-extensions/index.js', () => ({
  listAgentExtensions: (...args: unknown[]) => mockListAgentExtensions(...args),
  addAgentExtension: (...args: unknown[]) => mockAddAgentExtension(...args),
  reseedAgentExtension: (...args: unknown[]) => mockReseedAgentExtension(...args),
  deleteAgentExtension: (...args: unknown[]) => mockDeleteAgentExtension(...args),
  loadAgentLaunchExtensionAssignments: (...args: unknown[]) => mockLoadAgentLaunchExtensionAssignments(...args),
  saveAgentLaunchExtensionAssignments: (...args: unknown[]) => mockSaveAgentLaunchExtensionAssignments(...args),
}));

vi.mock('../../../backend/platform/cli-provider/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../backend/platform/cli-provider/index.js')>();
  return {
    ...actual,
    getActiveProvider: (repoRoot: string) => ({
      ...actual.getActiveProvider(repoRoot),
      agentConfigPaths: () => ({
        root: '.provider',
        instructions: '.provider/instructions',
        prompts: '.provider/prompts',
        profiles: '.provider/agents',
        registry: '.provider/agents/registry.json',
      }),
      modelCatalogPaths: () => ({
        default: '.provider/model-catalog.default.json',
        runtime: '.provider/state/model-catalog.json',
      }),
    }),
    // The save handlers validate assignment agent IDs against the descriptor roster.
    // The real descriptor reads a registry from disk; stub a fixed roster instead.
    getProviderFrontendDescriptor: () => ({
      roster: [
        { agentId: 'planning-agent' },
        { agentId: 'product-manager' },
        { agentId: 'software-engineer' },
        { agentId: 'software-engineer-verify' },
        { agentId: 'qa' },
      ],
    } as unknown as ReturnType<typeof actual.getProviderFrontendDescriptor>),
  };
});

type MemoryFsSeed = Record<string, string>;

class MemoryFs {
  readonly files = new Map<string, string>();
  readonly operations: string[] = [];

  constructor(seed: MemoryFsSeed = {}) {
    for (const [filePath, contents] of Object.entries(seed)) {
      this.files.set(filePath, contents);
    }
  }

  async readTextFile(filePath: string): Promise<string> {
    this.operations.push(`read:${filePath}`);
    const value = this.files.get(filePath);
    if (value === undefined) {
      const error = new Error(`ENOENT: ${filePath}`) as Error & { code?: string };
      error.code = 'ENOENT';
      throw error;
    }
    return value;
  }

  async writeTextFile(filePath: string, contents: string): Promise<void> {
    this.operations.push(`write:${filePath}`);
    this.files.set(filePath, contents);
  }

  async rename(sourcePath: string, destinationPath: string): Promise<void> {
    this.operations.push(`rename:${sourcePath}->${destinationPath}`);
    const value = this.files.get(sourcePath);
    if (value === undefined) {
      throw new Error(`Missing source for rename: ${sourcePath}`);
    }
    this.files.set(destinationPath, value);
    this.files.delete(sourcePath);
  }

  async mkdir(directoryPath: string): Promise<void> {
    this.operations.push(`mkdir:${directoryPath}`);
  }
}

const repoRoot = '/repo';
const registryPath = path.join(repoRoot, '.provider/agents/registry.json');
const defaultCatalogPath = path.join(repoRoot, '.provider/model-catalog.default.json');
const catalogPath = path.join(repoRoot, '.provider/state/model-catalog.json');

const registryDocument = {
  schema_version: 1,
  agents: [
    {
      agent_id: 'provider-qa',
      human_name: 'Ron',
      role_name: 'QA and Closeout',
      required_model: 'gpt-5.4',
      workflow_order: 3,
      untouched_field: 'keep-me',
    },
    {
      agent_id: 'provider-planner',
      human_name: 'Lily',
      role_name: 'Planning Specialist',
      required_model: 'gpt-4.1',
      reasoning_effort: 'high',
      workflow_order: 0,
      interactive: true,
    },
    {
      agent_id: 'provider-builder',
      human_name: 'Dalton',
      role_name: 'Software Engineer',
      required_model: 'claude-sonnet-4.6',
      workflow_order: 2,
      deny_rules: ['shell(git add)'],
    },
  ],
};

const defaultCatalogDocument = {
  schema_version: 1,
  models: [
    { display_name: 'gpt-4.1', model_id: 'gpt-4.1' },
    { display_name: 'gpt-5.4', model_id: 'gpt-5.4' },
    { display_name: 'claude-sonnet-4.6', model_id: 'claude-sonnet-4.6' },
  ],
};

function asJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe('agentConfigHandlers', () => {
  it('loads live agent data sorted by workflow_order and returns the slim list', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.loadAgents();

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.loadAgents',
        mode: 'read-only',
        message: '3 agent(s) loaded.',
        agents: [
          {
            agent_id: 'provider-planner',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-4.1',
            reasoning_effort: 'high',
            workflow_order: 0,
          },
          {
            agent_id: 'provider-builder',
            human_name: 'Dalton',
            role_name: 'Software Engineer',
            required_model: 'claude-sonnet-4.6',
            workflow_order: 2,
          },
          {
            agent_id: 'provider-qa',
            human_name: 'Ron',
            role_name: 'QA and Closeout',
            required_model: 'gpt-5.4',
            workflow_order: 3,
          },
        ],
      },
    });
  });

  it('seeds the model catalog from the tracked default when the runtime file is missing', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      now: () => 42,
    });

    const result = await handlers.loadModelCatalog();

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.loadModelCatalog',
        mode: 'read-only',
        message: 'Seeded model catalog with 3 model(s) from the tracked default.',
        models: defaultCatalogDocument.models,
      },
    });

    const tempPath = `${catalogPath}.tmp-${process.pid}-42`;
    expect(memoryFs.operations).toContain(`mkdir:${path.dirname(catalogPath)}`);
    expect(memoryFs.operations).toContain(`write:${tempPath}`);
    expect(memoryFs.operations).toContain(`rename:${tempPath}->${catalogPath}`);
    expect(memoryFs.files.get(catalogPath)).toBe(asJson(defaultCatalogDocument));
  });

  it('patches only required_model values and preserves JSON formatting on registry saves', async () => {
    const extendedCatalog = {
      schema_version: 1,
      models: [
        ...defaultCatalogDocument.models,
        { display_name: 'claude-opus-4.6', model_id: 'claude-opus-4.6' },
      ],
    };
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(extendedCatalog),
      [catalogPath]: asJson(extendedCatalog),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      now: () => 7,
    });

    const result = await handlers.saveAgentModels({
      assignments: [
        { agent_id: 'provider-planner', model_id: 'gpt-5.4' },
        { agent_id: 'provider-builder', model_id: 'claude-opus-4.6' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.saveAgentModels',
        mode: 'mutated',
        message: 'Saved model assignments for 2 agent(s).',
        agents: [
          {
            agent_id: 'provider-planner',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-5.4',
            workflow_order: 0,
          },
          {
            agent_id: 'provider-builder',
            human_name: 'Dalton',
            role_name: 'Software Engineer',
            required_model: 'claude-opus-4.6',
            workflow_order: 2,
          },
          {
            agent_id: 'provider-qa',
            human_name: 'Ron',
            role_name: 'QA and Closeout',
            required_model: 'gpt-5.4',
            workflow_order: 3,
          },
        ],
      },
    });

    expect(memoryFs.files.get(registryPath)).toBe(
      asJson({
        schema_version: 1,
        agents: [
          {
            agent_id: 'provider-qa',
            human_name: 'Ron',
            role_name: 'QA and Closeout',
            required_model: 'gpt-5.4',
            workflow_order: 3,
            untouched_field: 'keep-me',
          },
          {
            agent_id: 'provider-planner',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-5.4',
            workflow_order: 0,
            interactive: true,
          },
          {
            agent_id: 'provider-builder',
            human_name: 'Dalton',
            role_name: 'Software Engineer',
            required_model: 'claude-opus-4.6',
            workflow_order: 2,
            deny_rules: ['shell(git add)'],
          },
        ],
      }),
    );
    expect(memoryFs.files.get(registryPath)?.endsWith('\n')).toBe(true);
  });

  it('loads provider reasoning effort capabilities', async () => {
    const handlers = createAgentConfigHandlers({
      repoRoot,
      loadCapabilities: vi.fn(async () => ({
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['none', 'low', 'medium', 'high'],
        source: 'probe' as const,
        stale: false,
      })),
    });

    await expect(handlers.loadCapabilities()).resolves.toEqual({
      ok: true,
      response: {
        action: 'agentConfig.loadCapabilities',
        mode: 'read-only',
        message: 'Loaded 4 reasoning effort option(s).',
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['none', 'low', 'medium', 'high'],
        stale: false,
      },
    });
  });

  it('writes advertised reasoning effort and deletes effort for None while preserving other fields', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      now: () => 8,
      loadCapabilities: vi.fn(async () => ({
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['low', 'medium', 'high'],
        source: 'cache' as const,
        stale: false,
      })),
    });

    const result = await handlers.saveAgentModels({
      assignments: [
        { agent_id: 'provider-planner', model_id: 'gpt-4.1', reasoning_effort: 'none' },
        { agent_id: 'provider-builder', model_id: 'claude-sonnet-4.6', reasoning_effort: 'medium' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    const saved = JSON.parse(memoryFs.files.get(registryPath) ?? '{}') as typeof registryDocument;
    expect(saved.agents.find((agent) => agent.agent_id === 'provider-planner')).not.toHaveProperty('reasoning_effort');
    expect(saved.agents.find((agent) => agent.agent_id === 'provider-builder')).toEqual(expect.objectContaining({
      reasoning_effort: 'medium',
      deny_rules: ['shell(git add)'],
    }));
    expect(saved.agents.find((agent) => agent.agent_id === 'provider-qa')).toEqual(expect.objectContaining({
      untouched_field: 'keep-me',
    }));
  });

  it('rejects effort absent from provider capabilities before registry write', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      loadCapabilities: vi.fn(async () => ({
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['low'],
        source: 'probe' as const,
        stale: false,
      })),
    });

    const result = await handlers.saveAgentModels({
      assignments: [
        { agent_id: 'provider-planner', model_id: 'gpt-4.1', reasoning_effort: 'max' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'agentConfig.saveAgentModels',
      error: 'Reasoning effort "max" is not advertised by the installed Copilot CLI. Select None or a Copilot-advertised effort.',
    }));
    expect(memoryFs.files.get(registryPath)).toBe(asJson(registryDocument));
  });

  it('rejects malformed reasoning effort payloads before registry write', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      loadCapabilities: vi.fn(async () => ({
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['low', 'medium', 'high'],
        source: 'probe' as const,
        stale: false,
      })),
    });

    const result = await handlers.saveAgentModels({
      assignments: [
        { agent_id: 'provider-planner', model_id: 'gpt-4.1', reasoning_effort: 'High' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'agentConfig.saveAgentModels',
      error: expect.stringContaining('lowercase letters'),
    }));
    expect(memoryFs.files.get(registryPath)).toBe(asJson(registryDocument));
  });

  it('rejects non-empty effort when capability discovery only has stale cache data', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      loadCapabilities: vi.fn(async () => ({
        providerId: 'copilot',
        cliVersion: 'GitHub Copilot CLI 1.0.54',
        effortChoices: ['low', 'medium', 'high'],
        source: 'cache' as const,
        stale: true,
        error: 'missing copilot',
      })),
    });

    const result = await handlers.saveAgentModels({
      assignments: [
        { agent_id: 'provider-planner', model_id: 'gpt-4.1', reasoning_effort: 'high' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      action: 'agentConfig.saveAgentModels',
      error: 'Reasoning effort options could not be loaded from the installed Copilot CLI. Set reasoning effort to None or try again after capabilities are available.',
    }));
    expect(memoryFs.files.get(registryPath)).toBe(asJson(registryDocument));
  });

  it('adds a model to the catalog and writes to both default and runtime', async () => {
    const smallCatalog = {
      schema_version: 1,
      models: [{ display_name: 'GPT 4.1', model_id: 'gpt-4.1' }],
    };
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(smallCatalog),
      [catalogPath]: asJson(smallCatalog),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
      now: () => 1,
    });

    const result = await handlers.addModel({
      display_name: 'Claude Sonnet 4.6',
      model_id: 'claude-sonnet-4.6',
    });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.addModel',
        mode: 'mutated',
        message: 'Added model "Claude Sonnet 4.6".',
        models: [
          { display_name: 'GPT 4.1', model_id: 'gpt-4.1' },
          { display_name: 'Claude Sonnet 4.6', model_id: 'claude-sonnet-4.6' },
        ],
      },
    });
    expect(memoryFs.files.has(defaultCatalogPath)).toBe(true);
    expect(memoryFs.files.has(catalogPath)).toBe(true);
  });

  it('rejects adding a model with an invalid ID format', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.addModel({
      display_name: 'Bad Model',
      model_id: '!invalid',
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, action: 'agentConfig.addModel' }),
    );
  });

  it('rejects adding a duplicate model ID', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.addModel({
      display_name: 'Duplicate',
      model_id: 'gpt-4.1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        action: 'agentConfig.addModel',
        error: expect.stringContaining('already exists'),
      }),
    );
  });

  it('rejects saving an agent model that is not in the catalog', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.saveAgentModels({
      assignments: [{ agent_id: 'provider-qa', model_id: 'unknown-model-9.9' }],
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        action: 'agentConfig.saveAgentModels',
        error: expect.stringContaining('not in the model catalog'),
      }),
    );
  });

  it('rejects saving an agent model with an invalid model ID', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.saveAgentModels({
      assignments: [{ agent_id: 'provider-qa', model_id: '$$bad$$' }],
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, action: 'agentConfig.saveAgentModels' }),
    );
  });

  it('rejects removing a model that is still assigned and names the blocking agents', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const handlers = createAgentConfigHandlers({
      repoRoot,
      fsAdapter: memoryFs,
    });

    const result = await handlers.removeModel({ model_id: 'gpt-4.1' });

    expect(result).toEqual({
      ok: false,
      action: 'agentConfig.removeModel',
      error:
        'Cannot remove model "gpt-4.1" because it is assigned to: Lily (provider-planner).',
    });
    expect(memoryFs.files.get(catalogPath)).toBe(asJson(defaultCatalogDocument));
  });
});

// ── agentExtensionCatalog handlers ───────────────────────────────────────────

const sampleEntry = {
  id: 'my-skill',
  kind: 'skill' as const,
  provider_id: 'copilot' as const,
  display_name: 'My Skill',
  description: 'Does things.',
  enabled: true,
  source_type: 'git' as const,
  imported_at: '2026-01-01T00:00:00.000Z',
  status: 'available' as const,
  metadata: { skill_names: ['do-thing'] },
};

describe('agentExtensionCatalog handlers', () => {
  it('listExtensions returns entries from the backend and does not expose raw paths', async () => {
    mockListAgentExtensions.mockResolvedValueOnce([sampleEntry]);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.listExtensions();

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.listExtensions',
        mode: 'read-only',
        message: '1 extension(s) loaded.',
        extensions: [sampleEntry],
      },
    });

    // Verify no raw path fields are present in the response
    const responseStr = JSON.stringify(result);
    expect(responseStr).not.toMatch(/runtime_path/);
    expect(responseStr).not.toMatch(/config_path/);
  });

  it('listExtensions returns a structured error when the backend throws', async () => {
    mockListAgentExtensions.mockRejectedValueOnce(new Error('disk error'));
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.listExtensions();

    expect(result).toEqual(
      expect.objectContaining({ ok: false, action: 'agentConfig.listExtensions' }),
    );
  });

  it('addExtension (git) delegates to backend and returns sanitized entry', async () => {
    mockAddAgentExtension.mockResolvedValueOnce(sampleEntry);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.addExtension({
      id: 'my-skill',
      kind: 'skill',
      provider_id: 'copilot',
      source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
    });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.addExtension',
        mode: 'mutated',
        message: 'Added extension "My Skill".',
        extension: sampleEntry,
      },
    });

    expect(mockAddAgentExtension).toHaveBeenCalledWith(
      repoRoot,
      expect.objectContaining({ id: 'my-skill', kind: 'skill', source: expect.objectContaining({ type: 'git' }) }),
    );
  });

  it('addExtension returns a structured error and does not leak source URLs', async () => {
    mockAddAgentExtension.mockRejectedValueOnce(new Error('git clone failed'));
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.addExtension({
      id: 'my-skill',
      kind: 'skill',
      provider_id: 'copilot',
      source: { type: 'git', url: 'https://secret.host/private/repo', ref: 'main' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Sanitized: no source URL in error
      expect(result.error).not.toContain('secret.host');
      // Sanitized: no raw git error message
      expect(result.error).not.toContain('git clone failed');
      // Fixed safe message
      expect(result.error).toBe('Failed to add extension. Check the source configuration.');
    }
  });

  it('addExtension (direct-attachment) forwards skill_markdown to the backend without writing SKILL.md itself', async () => {
    // Use a real temp repoRoot so we can verify the handler does NOT touch the filesystem.
    const { mkdtempSync, mkdirSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const tmpRepoRoot = mkdtempSync(tmpdir() + '/test-direct-attach-');
    mkdirSync(path.join(tmpRepoRoot, 'config'), { recursive: true });

    const SKILL_MARKDOWN = '---\nname: Direct\ndescription: Direct skill\n---\n# Direct\n';
    const expectedConfigPath = path.join(tmpRepoRoot, 'config', 'skill-authored', 'direct-skill', 'SKILL.md');

    // The authored write now lives inside the backend transaction (single-writer),
    // so the file must not exist at the moment the handler delegates.
    let skillMdExistsAtCallTime = true;
    mockAddAgentExtension.mockImplementationOnce(async () => {
      skillMdExistsAtCallTime = existsSync(expectedConfigPath);
      return { ...sampleEntry, source_type: 'direct-attachment' as const };
    });

    const handlers = createAgentExtensionCatalogHandlers({ repoRoot: tmpRepoRoot });
    const result = await handlers.addExtension({
      id: 'direct-skill',
      kind: 'skill',
      provider_id: 'copilot',
      source: { type: 'direct-attachment', skill_markdown: SKILL_MARKDOWN },
    });

    // Handler must not write the authored file — the backend owns that write.
    expect(skillMdExistsAtCallTime).toBe(false);
    expect(existsSync(expectedConfigPath)).toBe(false);
    // Handler forwards the raw markdown (not a config_path) to the backend.
    expect(mockAddAgentExtension).toHaveBeenCalledWith(
      tmpRepoRoot,
      expect.objectContaining({
        id: 'direct-skill',
        source: { type: 'direct-attachment', skill_markdown: SKILL_MARKDOWN },
      }),
    );
    expect(result.ok).toBe(true);

    rmSync(tmpRepoRoot, { recursive: true, force: true });
  });

  it('reseedExtension delegates to backend and returns sanitized entry', async () => {
    const reseededEntry = { ...sampleEntry, reseeded_at: '2026-02-01T00:00:00.000Z' };
    mockReseedAgentExtension.mockResolvedValueOnce(reseededEntry);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.reseedExtension({ id: 'my-skill' });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.reseedExtension',
        mode: 'mutated',
        message: 'Reseeded extension "My Skill".',
        extension: reseededEntry,
      },
    });
  });

  it('reseedExtension returns error when backend throws', async () => {
    mockReseedAgentExtension.mockRejectedValueOnce(new Error('not found'));
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.reseedExtension({ id: 'missing' });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, action: 'agentConfig.reseedExtension' }),
    );
  });

  it('deleteExtension delegates to backend and returns id', async () => {
    mockDeleteAgentExtension.mockResolvedValueOnce(undefined);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.deleteExtension({ id: 'my-skill' });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.deleteExtension',
        mode: 'deleted',
        message: 'Deleted extension "my-skill".',
        id: 'my-skill',
      },
    });
  });

  it('deleteExtension forwards remove_assignments to the backend as removeAssignments', async () => {
    mockDeleteAgentExtension.mockResolvedValueOnce(undefined);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    await handlers.deleteExtension({ id: 'my-skill', remove_assignments: true });

    expect(mockDeleteAgentExtension).toHaveBeenCalledWith(
      repoRoot,
      'my-skill',
      { removeAssignments: true },
    );
  });

  it('deleteExtension defaults removeAssignments to false when omitted', async () => {
    mockDeleteAgentExtension.mockResolvedValueOnce(undefined);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    await handlers.deleteExtension({ id: 'my-skill' });

    expect(mockDeleteAgentExtension).toHaveBeenCalledWith(
      repoRoot,
      'my-skill',
      { removeAssignments: false },
    );
  });

  it('loadExtensionAssignments returns assignments from backend', async () => {
    const assignments = {
      schema_version: 1 as const,
      assignments: [
        { agent_id: 'software-engineer' as const, extension_ids: ['my-skill'] },
      ],
    };
    mockLoadAgentLaunchExtensionAssignments.mockResolvedValueOnce(assignments);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.loadExtensionAssignments();

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.loadExtensionAssignments',
        mode: 'read-only',
        message: '1 agent assignment(s) loaded.',
        assignments: assignments.assignments,
      },
    });

    // Assignments must only contain IDs — no runtime paths
    const responseStr = JSON.stringify(result);
    expect(responseStr).not.toMatch(/runtime_path/);
    expect(responseStr).not.toMatch(/source/);
  });

  it('saveExtensionAssignments delegates to backend and returns saved assignments', async () => {
    const inputAssignments = [
      { agent_id: 'software-engineer' as const, extension_ids: ['my-skill'] },
    ];
    const saved = {
      schema_version: 1 as const,
      assignments: inputAssignments,
    };
    mockSaveAgentLaunchExtensionAssignments.mockResolvedValueOnce(saved);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.saveExtensionAssignments({ assignments: inputAssignments });

    expect(result).toEqual({
      ok: true,
      response: {
        action: 'agentConfig.saveExtensionAssignments',
        mode: 'mutated',
        message: 'Saved extension assignments for 1 agent(s).',
        assignments: inputAssignments,
      },
    });
  });

  it('saveExtensionAssignments returns error when backend rejects', async () => {
    mockSaveAgentLaunchExtensionAssignments.mockRejectedValueOnce(
      new Error('unknown extension id'),
    );
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.saveExtensionAssignments({
      assignments: [{ agent_id: 'software-engineer' as const, extension_ids: ['ghost-id'] }],
    });

    expect(result).toEqual(
      expect.objectContaining({ ok: false, action: 'agentConfig.saveExtensionAssignments' }),
    );
  });

  it('saveExtensionAssignments rejects an unknown agent ID against the descriptor roster', async () => {
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.saveExtensionAssignments({
      assignments: [{ agent_id: 'not-a-real-agent', extension_ids: ['my-skill'] }],
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, action: 'agentConfig.saveExtensionAssignments' });
    // The unknown ID is named in the failed save result; persistence is never reached.
    expect(JSON.stringify(result)).toContain('not-a-real-agent');
    expect(mockSaveAgentLaunchExtensionAssignments).not.toHaveBeenCalled();
  });

  it('existing model-save behavior is unaffected by extension handler changes', async () => {
    const memoryFs = new MemoryFs({
      [registryPath]: asJson(registryDocument),
      [defaultCatalogPath]: asJson(defaultCatalogDocument),
      [catalogPath]: asJson(defaultCatalogDocument),
    });
    const agentHandlers = createAgentConfigHandlers({ repoRoot, fsAdapter: memoryFs });

    const result = await agentHandlers.addModel({ display_name: 'GPT-5', model_id: 'gpt-5' });

    expect(result).toEqual(
      expect.objectContaining({ ok: true }),
    );
    if (result.ok) {
      expect(result.response.action).toBe('agentConfig.addModel');
    }
  });

  // ── Track F: Skills & Plugins catalog contract ───────────────────────────────

  it('listExtensions for a plugin entry contains plugin_skill_count and no skill_names field', async () => {
    const pluginEntry = {
      id: 'my-plugin',
      kind: 'plugin' as const,
      provider_id: 'copilot' as const,
      display_name: 'my-plugin',
      description: 'A plugin.',
      enabled: true,
      source_type: 'local' as const,
      imported_at: '2026-01-01T00:00:00.000Z',
      status: 'available' as const,
      metadata: { plugin_component_classes: ['FooPlugin'], plugin_skill_count: 2 },
    };
    mockListAgentExtensions.mockResolvedValueOnce([pluginEntry]);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.listExtensions();

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'agentConfig.listExtensions') {
      const ext = result.response.extensions[0];
      // Plugin display_name IS the manifest slug (lowercase), not a human label
      expect(ext.display_name).toBe('my-plugin');
      // Plugin metadata has plugin_skill_count
      expect(ext.metadata.plugin_skill_count).toBe(2);
      // Plugin metadata must NOT have skill_names (that is a skill-only field)
      expect(ext.metadata.skill_names).toBeUndefined();
    } else {
      throw new Error('expected an ok agentConfig.listExtensions response');
    }
  });

  it('listExtensions does NOT return skill_names for a plugin (negative: no bundled-skills disclosure)', async () => {
    // A plugin with skill_names accidentally set should not surface them in catalog output
    // (the backend contract guarantees this; the handler must not inject them)
    const pluginEntry = {
      id: 'bad-plugin',
      kind: 'plugin' as const,
      provider_id: 'copilot' as const,
      display_name: 'bad-plugin',
      description: '',
      enabled: true,
      source_type: 'git' as const,
      status: 'available' as const,
      // Simulates backend returning an entry without skill_names (production contract)
      metadata: { plugin_component_classes: [] as string[], plugin_skill_count: 0 },
    };
    mockListAgentExtensions.mockResolvedValueOnce([pluginEntry]);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.listExtensions();

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'agentConfig.listExtensions') {
      const ext = result.response.extensions[0];
      expect(ext.metadata.skill_names).toBeUndefined();
    } else {
      throw new Error('expected an ok agentConfig.listExtensions response');
    }
  });

  it('saveExtensionAssignments response contains only agent_id and extension_ids (IDs only, no paths)', async () => {
    const inputAssignments = [
      { agent_id: 'planning-agent' as const, extension_ids: ['my-skill', 'my-plugin'] },
      { agent_id: 'qa' as const, extension_ids: [] },
    ];
    mockSaveAgentLaunchExtensionAssignments.mockResolvedValueOnce({
      schema_version: 1 as const,
      assignments: inputAssignments,
    });
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.saveExtensionAssignments({ assignments: inputAssignments });

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'agentConfig.saveExtensionAssignments') {
      const responseStr = JSON.stringify(result.response);
      // IDs only — no source paths, no metadata blobs, no runtime_path
      expect(responseStr).not.toMatch(/source_path|runtime_path|skill_markdown|plugin_manifest/);
      const plannerEntry = result.response.assignments.find((a) => a.agent_id === 'planning-agent');
      expect(plannerEntry?.extension_ids).toEqual(['my-skill', 'my-plugin']);
    } else {
      throw new Error('expected an ok agentConfig.saveExtensionAssignments response');
    }
  });

  it('saveExtensionAssignments with empty extension list for an agent stores an empty array (negative: no implicit defaults)', async () => {
    const inputAssignments = [{ agent_id: 'software-engineer' as const, extension_ids: [] }];
    mockSaveAgentLaunchExtensionAssignments.mockResolvedValueOnce({
      schema_version: 1 as const,
      assignments: inputAssignments,
    });
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.saveExtensionAssignments({ assignments: inputAssignments });

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'agentConfig.saveExtensionAssignments') {
      const entry = result.response.assignments.find((a) => a.agent_id === 'software-engineer');
      expect(entry?.extension_ids).toEqual([]);
    } else {
      throw new Error('expected an ok agentConfig.saveExtensionAssignments response');
    }
  });

  it('reseedExtension supports manual reseed: delegates to backend and confirms response is the updated entry', async () => {
    const updatedEntry = { ...sampleEntry, reseeded_at: '2026-05-28T00:00:00.000Z' };
    mockReseedAgentExtension.mockResolvedValueOnce(updatedEntry);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    const result = await handlers.reseedExtension({ id: sampleEntry.id });

    expect(result.ok).toBe(true);
    if (result.ok && result.response.action === 'agentConfig.reseedExtension') {
      expect(result.response.extension.reseeded_at).toBe('2026-05-28T00:00:00.000Z');
    } else {
      throw new Error('expected an ok agentConfig.reseedExtension response');
    }
  });

  it('reseedExtension without being called first (negative: no auto-reseed on list)', async () => {
    // The list call must NOT trigger a reseed
    mockListAgentExtensions.mockResolvedValueOnce([sampleEntry]);
    const handlers = createAgentExtensionCatalogHandlers({ repoRoot });

    await handlers.listExtensions();

    expect(mockReseedAgentExtension).not.toHaveBeenCalled();
  });
});
