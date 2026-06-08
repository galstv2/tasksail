import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENT_MODEL_PATTERN,
} from '../../../../backend/platform/workflow-policy/index.js';
import {
  getActiveProvider,
  normalizeReasoningEffort,
  validateReasoningEffortForCapabilities,
  type ProviderReasoningEffortCapabilities,
} from '../../../../backend/platform/cli-provider/index.js';

import type {
  AgentConfigAddModelRequest,
  AgentConfigAgentEntry,
  AgentConfigLoadAgentsResponse,
  AgentConfigLoadCapabilitiesResponse,
  AgentConfigLoadModelCatalogResponse,
  AgentConfigModelCatalogEntry,
  AgentConfigRemoveModelRequest,
  AgentConfigSaveAgentModelsRequest,
  DesktopInvokeResult,
} from '../../src/shared/desktopContract';
import { isValidTimeoutSeconds } from '../../src/shared/desktopContractValidationCore';
import { REPO_ROOT } from '../paths';

const MODEL_CATALOG_SCHEMA_VERSION = 1;

type JsonRecord = Record<string, unknown>;

type RegistryAgentRecord = JsonRecord & {
  agent_id: string;
  human_name: string;
  role_name: string;
  required_model: string;
  reasoning_effort?: string;
  workflow_order: number;
  wall_clock_timeout_s?: number;
  idle_timeout_s?: number;
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
  loadCapabilities?: (repoRoot: string) => Promise<ProviderReasoningEffortCapabilities>;
};

type ReasoningEffortCapabilityProvider = {
  reasoningEffortCapabilities?: (repoRoot: string) => Promise<ProviderReasoningEffortCapabilities>;
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
  if (value.reasoning_effort !== undefined && value.reasoning_effort !== null) {
    if (typeof value.reasoning_effort !== 'string') {
      throw new Error(`Agent ${value.agent_id} has an invalid reasoning_effort.`);
    }
    const normalizedEffort = normalizeReasoningEffort(value.reasoning_effort);
    if (normalizedEffort) {
      value.reasoning_effort = normalizedEffort;
    } else {
      delete value.reasoning_effort;
    }
  }
  if (
    value.wall_clock_timeout_s !== undefined
    && value.wall_clock_timeout_s !== null
    && !isValidTimeoutSeconds(value.wall_clock_timeout_s)
  ) {
    throw new Error(`Agent ${value.agent_id} has an invalid wall_clock_timeout_s.`);
  }
  if (
    value.idle_timeout_s !== undefined
    && value.idle_timeout_s !== null
    && !isValidTimeoutSeconds(value.idle_timeout_s)
  ) {
    throw new Error(`Agent ${value.agent_id} has an invalid idle_timeout_s.`);
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
    ...(agent.reasoning_effort ? { reasoning_effort: agent.reasoning_effort } : {}),
    workflow_order: agent.workflow_order,
    ...(typeof agent.wall_clock_timeout_s === 'number' ? { wall_clock_timeout_s: agent.wall_clock_timeout_s } : {}),
    ...(typeof agent.idle_timeout_s === 'number' ? { idle_timeout_s: agent.idle_timeout_s } : {}),
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
  return path.join(repoRoot, getActiveProvider(repoRoot).modelCatalogPaths().runtime);
}

function buildDefaultModelCatalogPath(repoRoot: string): string {
  return path.join(repoRoot, getActiveProvider(repoRoot).modelCatalogPaths().default);
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
  const defaultRelativePath = getActiveProvider(repoRoot).modelCatalogPaths().default;
  const defaultPath = path.join(repoRoot, defaultRelativePath);
  const raw = await fsAdapter.readTextFile(defaultPath);
  return normalizeModelCatalogDocument(
    parseJsonDocument(raw, defaultRelativePath),
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

function validateReasoningEffortSyntax(action: string, effort: string): DesktopInvokeResult | null {
  if (effort === effort.trim() && /^[a-z][a-z0-9-]*$/.test(effort)) {
    return null;
  }
  return fail(action, `Reasoning effort "${effort}" must be lowercase letters, numbers, or hyphens.`);
}

function providerProductDisplayName(cliDisplayName: string): string {
  return cliDisplayName.replace(/\s+CLI$/u, '') || cliDisplayName;
}

function providerAdvertisedReasoningEffortLabel(cliDisplayName: string): string {
  return `${providerProductDisplayName(cliDisplayName)}-advertised`;
}

async function loadProviderCapabilities(repoRoot: string): Promise<ProviderReasoningEffortCapabilities> {
  const provider = getActiveProvider(repoRoot);
  const capabilityProvider = provider as typeof provider & ReasoningEffortCapabilityProvider;
  if (!capabilityProvider.reasoningEffortCapabilities) {
    return {
      providerId: provider.id,
      cliVersion: null,
      effortChoices: [],
      source: 'unavailable',
      stale: true,
      error: `${provider.cliDisplayName()} does not expose reasoning effort capabilities.`,
    };
  }
  return capabilityProvider.reasoningEffortCapabilities(repoRoot);
}

function buildLoadAgentsResponse(agents: AgentConfigAgentEntry[]): AgentConfigLoadAgentsResponse {
  return {
    action: 'agentConfig.loadAgents',
    mode: 'read-only',
    message: `${agents.length} agent(s) loaded.`,
    agents,
  };
}

function buildLoadCapabilitiesResponse(
  capabilities: ProviderReasoningEffortCapabilities,
  cliDisplayName: string,
): AgentConfigLoadCapabilitiesResponse {
  const choices = capabilities.effortChoices;
  const unavailable = capabilities.source === 'unavailable' || choices.length === 0;
  return {
    action: 'agentConfig.loadCapabilities',
    mode: 'read-only',
    message: unavailable
      ? `Reasoning effort options could not be loaded from the installed ${cliDisplayName}.`
      : `Loaded ${choices.length} reasoning effort option(s).`,
    providerId: capabilities.providerId,
    cliVersion: capabilities.cliVersion,
    effortChoices: choices,
    stale: capabilities.stale,
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
  const loadCapabilities = options.loadCapabilities ?? loadProviderCapabilities;

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

    loadCapabilities: async (): Promise<DesktopInvokeResult> => {
      const provider = getActiveProvider(repoRoot);
      const cliDisplayName = provider.cliDisplayName();
      try {
        const capabilities = await loadCapabilities(repoRoot);
        return {
          ok: true,
          response: buildLoadCapabilitiesResponse(capabilities, cliDisplayName),
        };
      } catch (err) {
        return {
          ok: true,
          response: buildLoadCapabilitiesResponse({
            providerId: provider.id,
            cliVersion: null,
            effortChoices: [],
            source: 'unavailable',
            stale: true,
            error: err instanceof Error ? err.message : String(err),
          }, cliDisplayName),
        };
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
        const assignments = new Map<
          string,
          { modelId: string; reasoningEffort?: string; wallClockTimeoutS?: number; idleTimeoutS?: number }
        >();
        const requestedEfforts = new Set<string>();
        // Resolve the active provider's planner agent up front; idle_timeout_s is planner-only.
        const plannerAgentId = getActiveProvider(repoRoot).plannerAgentId();

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
          if (
            assignment.reasoning_effort !== undefined &&
            assignment.reasoning_effort !== null &&
            typeof assignment.reasoning_effort !== 'string'
          ) {
            return fail(
              'agentConfig.saveAgentModels',
              'Reasoning effort must be lowercase letters, numbers, or hyphens when provided.',
            );
          }
          const reasoningEffort = normalizeReasoningEffort(assignment.reasoning_effort);
          if (reasoningEffort) {
            const effortValidation = validateReasoningEffortSyntax(
              'agentConfig.saveAgentModels',
              assignment.reasoning_effort as string,
            );
            if (effortValidation) {
              return effortValidation;
            }
            requestedEfforts.add(reasoningEffort);
          }
          if (
            assignment.wall_clock_timeout_s !== undefined
            && !isValidTimeoutSeconds(assignment.wall_clock_timeout_s)
          ) {
            return fail(
              'agentConfig.saveAgentModels',
              'Wall clock timeout must be an integer number of seconds from 1 to 86400 when provided.',
            );
          }
          if (assignment.idle_timeout_s !== undefined) {
            if (!isValidTimeoutSeconds(assignment.idle_timeout_s)) {
              return fail(
                'agentConfig.saveAgentModels',
                'Idle timeout must be an integer number of seconds from 1 to 86400 when provided.',
              );
            }
            if (plannerAgentId === null || assignment.agent_id !== plannerAgentId) {
              return fail(
                'agentConfig.saveAgentModels',
                'Idle timeout can only be set for the planner agent.',
              );
            }
          }
          assignments.set(assignment.agent_id, {
            modelId: assignment.model_id,
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(assignment.wall_clock_timeout_s !== undefined ? { wallClockTimeoutS: assignment.wall_clock_timeout_s } : {}),
            ...(assignment.idle_timeout_s !== undefined ? { idleTimeoutS: assignment.idle_timeout_s } : {}),
          });
        }

        if (requestedEfforts.size > 0) {
          const cliDisplayName = getActiveProvider(repoRoot).cliDisplayName();
          const capabilities = await loadCapabilities(repoRoot);
          for (const effort of requestedEfforts) {
            const validation = validateReasoningEffortForCapabilities({
              providerId: capabilities.providerId,
              cliDisplayName,
              modelId: 'selected model',
              effort,
              capabilities,
            });
            if (!validation.ok) {
              const error = validation.reason === 'capability-discovery-failed'
                ? `Reasoning effort options could not be loaded from the installed ${cliDisplayName}. Set reasoning effort to None or try again after capabilities are available.`
                : `Reasoning effort "${effort}" is not advertised by the installed ${cliDisplayName}. Select None or a ${providerAdvertisedReasoningEffortLabel(cliDisplayName)} effort.`;
              return fail('agentConfig.saveAgentModels', error);
            }
          }
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
          const assignment = assignments.get(agent.agent_id);
          if (assignment !== undefined) {
            agent.required_model = assignment.modelId;
            if (assignment.reasoningEffort) {
              agent.reasoning_effort = assignment.reasoningEffort;
            } else {
              delete agent.reasoning_effort;
            }
            // Timeouts are only written when supplied; omission preserves existing values.
            if (assignment.wallClockTimeoutS !== undefined) {
              agent.wall_clock_timeout_s = assignment.wallClockTimeoutS;
            }
            if (assignment.idleTimeoutS !== undefined) {
              agent.idle_timeout_s = assignment.idleTimeoutS;
            }
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
export const loadAgentConfigCapabilities = defaultAgentConfigHandlers.loadCapabilities;
export const saveAgentModels = defaultAgentConfigHandlers.saveAgentModels;
export const addAgentModel = defaultAgentConfigHandlers.addModel;
export const removeAgentModel = defaultAgentConfigHandlers.removeModel;
