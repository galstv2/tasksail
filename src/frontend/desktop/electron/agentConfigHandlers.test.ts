import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createAgentConfigHandlers } from './agentConfigHandlers';

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
const registryPath = path.join(repoRoot, '.github/agents/registry.json');
const defaultCatalogPath = path.join(repoRoot, 'config/agent-model-catalog.default.json');
const catalogPath = path.join(repoRoot, '.platform-state/agent-model-catalog.json');

const registryDocument = {
  schema_version: 1,
  agents: [
    {
      agent_id: 'qa',
      human_name: 'Ron',
      role_name: 'QA and Closeout',
      required_model: 'gpt-5.4',
      workflow_order: 3,
      untouched_field: 'keep-me',
    },
    {
      agent_id: 'planning-agent',
      human_name: 'Lily',
      role_name: 'Planning Specialist',
      required_model: 'gpt-4.1',
      workflow_order: 0,
      interactive: true,
    },
    {
      agent_id: 'software-engineer',
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
            agent_id: 'planning-agent',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-4.1',
            workflow_order: 0,
          },
          {
            agent_id: 'software-engineer',
            human_name: 'Dalton',
            role_name: 'Software Engineer',
            required_model: 'claude-sonnet-4.6',
            workflow_order: 2,
          },
          {
            agent_id: 'qa',
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
        { agent_id: 'planning-agent', model_id: 'gpt-5.4' },
        { agent_id: 'software-engineer', model_id: 'claude-opus-4.6' },
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
            agent_id: 'planning-agent',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-5.4',
            workflow_order: 0,
          },
          {
            agent_id: 'software-engineer',
            human_name: 'Dalton',
            role_name: 'Software Engineer',
            required_model: 'claude-opus-4.6',
            workflow_order: 2,
          },
          {
            agent_id: 'qa',
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
            agent_id: 'qa',
            human_name: 'Ron',
            role_name: 'QA and Closeout',
            required_model: 'gpt-5.4',
            workflow_order: 3,
            untouched_field: 'keep-me',
          },
          {
            agent_id: 'planning-agent',
            human_name: 'Lily',
            role_name: 'Planning Specialist',
            required_model: 'gpt-5.4',
            workflow_order: 0,
            interactive: true,
          },
          {
            agent_id: 'software-engineer',
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
      assignments: [{ agent_id: 'qa', model_id: 'unknown-model-9.9' }],
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
      assignments: [{ agent_id: 'qa', model_id: '$$bad$$' }],
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
        'Cannot remove model "gpt-4.1" because it is assigned to: Lily (planning-agent).',
    });
    expect(memoryFs.files.get(catalogPath)).toBe(asJson(defaultCatalogDocument));
  });
});
