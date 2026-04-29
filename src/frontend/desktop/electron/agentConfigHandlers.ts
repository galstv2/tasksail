import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_MODEL_CATALOG_RELATIVE_PATH,
  AGENT_MODEL_PATTERN,
} from '../../../backend/platform/workflow-policy/index.js';
import { getActiveProvider } from '../../../backend/platform/cli-provider/index.js';

import type {
  AgentConfigAddModelRequest,
  AgentConfigAgentEntry,
  AgentConfigLoadAgentsResponse,
  AgentConfigLoadModelCatalogResponse,
  AgentConfigModelCatalogEntry,
  AgentConfigRemoveModelRequest,
  AgentConfigSaveAgentModelsRequest,
  DesktopInvokeResult,
} from '../src/shared/desktopContract';
import { REPO_ROOT } from './paths';

const MODEL_CATALOG_RELATIVE_PATH = '.platform-state/agent-model-catalog.json';
const MODEL_CATALOG_SCHEMA_VERSION = 1;

type JsonRecord = Record<string, unknown>;

type RegistryAgentRecord = JsonRecord & {
  agent_id: string;
  human_name: string;
  role_name: string;
  required_model: string;
  workflow_order: number;
};

type AgentRegistryDocument = JsonRecord & {
  agents: RegistryAgentRecord[];
};

type AgentModelCatalogDocument = JsonRecord & {
  schema_version: number;
  models: AgentConfigModelCatalogEntry[];
};

type FileSystemAdapter = {
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  mkdir: (directoryPath: string) => Promise<void>;
};

type AgentConfigHandlerOptions = {
  repoRoot?: string;
  fsAdapter?: FileSystemAdapter;
  now?: () => number;
};

const defaultFsAdapter: FileSystemAdapter = {
  readTextFile: (filePath) => readFile(filePath, 'utf-8'),
  writeTextFile: (filePath, contents) => writeFile(filePath, contents, 'utf-8'),
  rename: (sourcePath, destinationPath) => rename(sourcePath, destinationPath),
  mkdir: async (directoryPath) => {
    await mkdir(directoryPath, { recursive: true });
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function parseJsonDocument(raw: string, description: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${description}: ${detail}`);
  }
}

function normalizeAgentRecord(value: unknown, index: number): RegistryAgentRecord {
  if (!isRecord(value)) {
    throw new Error(`Agent registry entry ${index} must be an object.`);
  }
  if (!isNonEmptyString(value.agent_id)) {
    throw new Error(`Agent registry entry ${index} is missing a valid agent_id.`);
  }
  if (!isNonEmptyString(value.human_name)) {
    throw new Error(`Agent ${value.agent_id} is missing a valid human_name.`);
  }
  if (!isNonEmptyString(value.role_name)) {
    throw new Error(`Agent ${value.agent_id} is missing a valid role_name.`);
  }
  if (!isNonEmptyString(value.required_model)) {
    throw new Error(`Agent ${value.agent_id} is missing a valid required_model.`);
  }
  if (!isFiniteNumber(value.workflow_order)) {
    throw new Error(`Agent ${value.agent_id} is missing a valid workflow_order.`);
  }
  return value as RegistryAgentRecord;
}

function normalizeRegistryDocument(value: unknown): AgentRegistryDocument {
  if (!isRecord(value) || !Array.isArray(value.agents)) {
    throw new Error('Agent registry must contain an agents array.');
  }
  value.agents = value.agents.map((agent, index) => normalizeAgentRecord(agent, index));
  return value as AgentRegistryDocument;
}

function normalizeModelEntry(value: unknown, index: number): AgentConfigModelCatalogEntry {
  if (!isRecord(value)) {
    throw new Error(`Model catalog entry ${index} must be an object.`);
  }
  if (!isNonEmptyString(value.display_name)) {
    throw new Error(`Model catalog entry ${index} is missing a valid display_name.`);
  }
  if (!isNonEmptyString(value.model_id)) {
    throw new Error(`Model catalog entry ${index} is missing a valid model_id.`);
  }
  return {
    display_name: value.display_name,
    model_id: value.model_id,
  };
}

function normalizeModelCatalogDocument(value: unknown): AgentModelCatalogDocument {
  if (!isRecord(value) || !Array.isArray(value.models)) {
    throw new Error('Agent model catalog must contain a models array.');
  }
  const schema_version = isFiniteNumber(value.schema_version)
    ? value.schema_version
    : MODEL_CATALOG_SCHEMA_VERSION;
  return {
    ...value,
    schema_version,
    models: value.models.map((model, index) => normalizeModelEntry(model, index)),
  };
}

function toSlimAgent(agent: RegistryAgentRecord): AgentConfigAgentEntry {
  return {
    agent_id: agent.agent_id,
    human_name: agent.human_name,
    role_name: agent.role_name,
    required_model: agent.required_model,
    workflow_order: agent.workflow_order,
  };
}

function sortAgents(agents: RegistryAgentRecord[]): RegistryAgentRecord[] {
  return [...agents].sort((left, right) => left.workflow_order - right.workflow_order);
}

function serializeJson(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function atomicWriteJson(
  filePath: string,
  document: unknown,
  fsAdapter: FileSystemAdapter,
  now: () => number,
): Promise<void> {
  const directoryPath = path.dirname(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}-${now()}`;
  await fsAdapter.mkdir(directoryPath);
  await fsAdapter.writeTextFile(tempPath, serializeJson(document));
  await fsAdapter.rename(tempPath, filePath);
}

function buildRegistryPath(repoRoot: string): string {
  return path.join(repoRoot, getActiveProvider(repoRoot).agentConfigPaths().registry);
}

function buildModelCatalogPath(repoRoot: string): string {
  return path.join(repoRoot, MODEL_CATALOG_RELATIVE_PATH);
}

function buildDefaultModelCatalogPath(repoRoot: string): string {
  return path.join(repoRoot, AGENT_MODEL_CATALOG_RELATIVE_PATH);
}

async function writeModelCatalog(
  repoRoot: string,
  document: AgentModelCatalogDocument,
  fsAdapter: FileSystemAdapter,
  now: () => number,
): Promise<void> {
  await Promise.all([
    atomicWriteJson(buildDefaultModelCatalogPath(repoRoot), document, fsAdapter, now),
    atomicWriteJson(buildModelCatalogPath(repoRoot), document, fsAdapter, now),
  ]);
}

async function readRegistryDocument(
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
): Promise<AgentRegistryDocument> {
  const registryPath = buildRegistryPath(repoRoot);
  const raw = await fsAdapter.readTextFile(registryPath);
  return normalizeRegistryDocument(
    parseJsonDocument(raw, getActiveProvider(repoRoot).agentConfigPaths().registry),
  );
}

async function readDefaultModelCatalogDocument(
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
): Promise<AgentModelCatalogDocument> {
  const defaultPath = path.join(repoRoot, AGENT_MODEL_CATALOG_RELATIVE_PATH);
  const raw = await fsAdapter.readTextFile(defaultPath);
  return normalizeModelCatalogDocument(
    parseJsonDocument(raw, AGENT_MODEL_CATALOG_RELATIVE_PATH),
  );
}

async function ensureModelCatalogDocument(
  repoRoot: string,
  fsAdapter: FileSystemAdapter,
  now: () => number,
): Promise<{ document: AgentModelCatalogDocument; seeded: boolean; updated: boolean }> {
  const document = await readDefaultModelCatalogDocument(repoRoot, fsAdapter);
  const defaultRaw = serializeJson(document);
  const catalogPath = buildModelCatalogPath(repoRoot);

  let runtimeRaw: string | undefined;
  try {
    runtimeRaw = await fsAdapter.readTextFile(catalogPath);
  } catch (error: unknown) {
    if (!isNotFoundError(error)) throw error;
  }

  if (runtimeRaw !== undefined) {
    if (runtimeRaw.trim() === defaultRaw.trim()) {
      return { document, seeded: false, updated: false };
    }
    await atomicWriteJson(catalogPath, document, fsAdapter, now);
    return { document, seeded: false, updated: true };
  }

  await atomicWriteJson(catalogPath, document, fsAdapter, now);
  return { document, seeded: true, updated: false };
}

function fail(action: string, error: string, details?: string[]): DesktopInvokeResult {
  return {
    ok: false,
    action,
    error,
    ...(details && details.length > 0 ? { details } : {}),
  };
}

function validateModelIdOrFail(action: string, modelId: string): DesktopInvokeResult | null {
  if (AGENT_MODEL_PATTERN.test(modelId)) {
    return null;
  }
  return fail(action, `Model ID "${modelId}" must match ${AGENT_MODEL_PATTERN.toString()}.`);
}

function buildLoadAgentsResponse(agents: AgentConfigAgentEntry[]): AgentConfigLoadAgentsResponse {
  return {
    action: 'agentConfig.loadAgents',
    mode: 'read-only',
    message: `${agents.length} agent(s) loaded.`,
    agents,
  };
}

function buildLoadModelCatalogResponse(
  models: AgentConfigModelCatalogEntry[],
  seeded: boolean,
  updated: boolean,
): AgentConfigLoadModelCatalogResponse {
  let message: string;
  if (seeded) {
    message = `Seeded model catalog with ${models.length} model(s) from the tracked default.`;
  } else if (updated) {
    message = `Updated model catalog to match the tracked default (${models.length} model(s)).`;
  } else {
    message = `${models.length} model(s) loaded.`;
  }
  return {
    action: 'agentConfig.loadModelCatalog',
    mode: 'read-only',
    message,
    models,
  };
}

export function createAgentConfigHandlers(options: AgentConfigHandlerOptions = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const fsAdapter = options.fsAdapter ?? defaultFsAdapter;
  const now = options.now ?? (() => Date.now());

  return {
    loadAgents: async (): Promise<DesktopInvokeResult> => {
      try {
        const registry = await readRegistryDocument(repoRoot, fsAdapter);
        const agents = sortAgents(registry.agents).map(toSlimAgent);
        return {
          ok: true,
          response: buildLoadAgentsResponse(agents),
        };
      } catch (err) {
        return fail('agentConfig.loadAgents', err instanceof Error ? err.message : String(err));
      }
    },

    loadModelCatalog: async (): Promise<DesktopInvokeResult> => {
      try {
        const { document, seeded, updated } = await ensureModelCatalogDocument(repoRoot, fsAdapter, now);
        return {
          ok: true,
          response: buildLoadModelCatalogResponse(document.models, seeded, updated),
        };
      } catch (err) {
        return fail('agentConfig.loadModelCatalog', err instanceof Error ? err.message : String(err));
      }
    },

    saveAgentModels: async (
      payload: AgentConfigSaveAgentModelsRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        const [registry, { document: catalog }] = await Promise.all([
          readRegistryDocument(repoRoot, fsAdapter),
          ensureModelCatalogDocument(repoRoot, fsAdapter, now),
        ]);
        const catalogModelIds = new Set(catalog.models.map((m) => m.model_id));
        const assignments = new Map<string, string>();

        for (const assignment of payload.assignments) {
          const modelValidation = validateModelIdOrFail(
            'agentConfig.saveAgentModels',
            assignment.model_id,
          );
          if (modelValidation) {
            return modelValidation;
          }
          if (!catalogModelIds.has(assignment.model_id)) {
            return fail(
              'agentConfig.saveAgentModels',
              `Model "${assignment.model_id}" is not in the model catalog. Add it to the catalog first.`,
            );
          }
          assignments.set(assignment.agent_id, assignment.model_id);
        }

        const unknownAgents = [...assignments.keys()].filter(
          (agentId) => !registry.agents.some((agent) => agent.agent_id === agentId),
        );
        if (unknownAgents.length > 0) {
          return fail(
            'agentConfig.saveAgentModels',
            `Unknown agent assignment target(s): ${unknownAgents.join(', ')}.`,
          );
        }

        for (const agent of registry.agents) {
          const nextModel = assignments.get(agent.agent_id);
          if (nextModel !== undefined) {
            agent.required_model = nextModel;
          }
        }

        await atomicWriteJson(buildRegistryPath(repoRoot), registry, fsAdapter, now);
        const agents = sortAgents(registry.agents).map(toSlimAgent);
        return {
          ok: true,
          response: {
            action: 'agentConfig.saveAgentModels',
            mode: 'mutated',
            message: `Saved model assignments for ${assignments.size} agent(s).`,
            agents,
          },
        };
      } catch (err) {
        return fail('agentConfig.saveAgentModels', err instanceof Error ? err.message : String(err));
      }
    },

    addModel: async (
      payload: AgentConfigAddModelRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        const modelValidation = validateModelIdOrFail('agentConfig.addModel', payload.model_id);
        if (modelValidation) {
          return modelValidation;
        }

        const { document } = await ensureModelCatalogDocument(repoRoot, fsAdapter, now);
        if (document.models.some((model) => model.model_id === payload.model_id)) {
          return fail(
            'agentConfig.addModel',
            `Model "${payload.model_id}" already exists in the catalog.`,
          );
        }

        document.models.push({
          display_name: payload.display_name,
          model_id: payload.model_id,
        });
        await writeModelCatalog(repoRoot, document, fsAdapter, now);
        return {
          ok: true,
          response: {
            action: 'agentConfig.addModel',
            mode: 'mutated',
            message: `Added model "${payload.display_name}".`,
            models: document.models,
          },
        };
      } catch (err) {
        return fail('agentConfig.addModel', err instanceof Error ? err.message : String(err));
      }
    },

    removeModel: async (
      payload: AgentConfigRemoveModelRequest['payload'],
    ): Promise<DesktopInvokeResult> => {
      try {
        const modelValidation = validateModelIdOrFail('agentConfig.removeModel', payload.model_id);
        if (modelValidation) {
          return modelValidation;
        }

        const { document } = await ensureModelCatalogDocument(repoRoot, fsAdapter, now);
        const registry = await readRegistryDocument(repoRoot, fsAdapter);
        const assignedAgents = sortAgents(registry.agents)
          .filter((agent) => agent.required_model === payload.model_id)
          .map((agent) => `${agent.human_name} (${agent.agent_id})`);
        if (assignedAgents.length > 0) {
          return fail(
            'agentConfig.removeModel',
            `Cannot remove model "${payload.model_id}" because it is assigned to: ${assignedAgents.join(', ')}.`,
          );
        }

        const nextModels = document.models.filter((model) => model.model_id !== payload.model_id);
        if (nextModels.length === document.models.length) {
          return fail(
            'agentConfig.removeModel',
            `Model "${payload.model_id}" was not found in the catalog.`,
          );
        }

        document.models = nextModels;
        await writeModelCatalog(repoRoot, document, fsAdapter, now);
        return {
          ok: true,
          response: {
            action: 'agentConfig.removeModel',
            mode: 'mutated',
            message: `Removed model "${payload.model_id}".`,
            models: document.models,
          },
        };
      } catch (err) {
        return fail('agentConfig.removeModel', err instanceof Error ? err.message : String(err));
      }
    },
  };
}

const defaultAgentConfigHandlers = createAgentConfigHandlers();

export const loadAgentConfigAgents = defaultAgentConfigHandlers.loadAgents;
export const loadAgentModelCatalog = defaultAgentConfigHandlers.loadModelCatalog;
export const saveAgentModels = defaultAgentConfigHandlers.saveAgentModels;
export const addAgentModel = defaultAgentConfigHandlers.addModel;
export const removeAgentModel = defaultAgentConfigHandlers.removeModel;
