export type AgentExtensionKind = 'skill' | 'plugin';
export type AgentExtensionSourceType = 'git' | 'local' | 'direct-attachment';
export type AgentExtensionProviderId = 'copilot';
export type AgentExtensionAgentId =
  | 'planning-agent'
  | 'product-manager'
  | 'software-engineer'
  | 'software-engineer-verify'
  | 'qa';

export type AgentExtensionSource =
  | {
      type: 'git';
      url: string;
      ref: string;
      commit_sha?: string;
      source_subpath?: string;
    }
  | {
      type: 'local';
      path: string;
      source_subpath?: string;
    }
  | {
      type: 'direct-attachment';
      config_path: string;
    };

export type AgentExtensionSourceManifestEntry = {
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  display_name: string;
  description: string;
  enabled: boolean;
  source: AgentExtensionSource;
};

export type AgentExtensionRuntimeCatalogEntry = AgentExtensionSourceManifestEntry & {
  runtime_path: string;
  imported_at: string;
  reseeded_at?: string;
  metadata: {
    skill_names?: string[];
    plugin_component_classes?: string[];
    plugin_skill_count?: number;
  };
};

export type AgentExtensionRendererCatalogEntry = {
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  display_name: string;
  description: string;
  enabled: boolean;
  source_type: AgentExtensionSourceType;
  imported_at?: string;
  reseeded_at?: string;
  status: 'available' | 'unavailable';
  metadata: {
    skill_names?: string[];
    plugin_component_classes?: string[];
    plugin_skill_count?: number;
  };
};

export type AgentExtensionImportReceipt = {
  schema_version: 1;
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  source_type: AgentExtensionSourceType;
  source_digest?: string;
  commit_sha?: string;
  runtime_path: string;
  imported_at: string;
  reseeded_at?: string;
};

export type AgentExtensionsSourceManifest = {
  schema_version: 1;
  extensions: AgentExtensionSourceManifestEntry[];
};

export type AgentLaunchExtensionAssignments = {
  schema_version: 1;
  assignments: Array<{
    agent_id: AgentExtensionAgentId;
    extension_ids: string[];
  }>;
};

export type AgentExtensionCatalogListResponse = {
  action: 'agentConfig.listExtensions';
  mode: 'read-only';
  message: string;
  extensions: AgentExtensionRendererCatalogEntry[];
};

export type AgentExtensionAssignmentListResponse = {
  action: 'agentConfig.loadExtensionAssignments';
  mode: 'read-only';
  message: string;
  assignments: AgentLaunchExtensionAssignments['assignments'];
};

// Add-request source shape. Identical to the durable manifest source for git/local,
// but direct-attachment carries the authored skill markdown (not a config_path):
// the backend writes config/skill-authored/<id>/SKILL.md under the lock and derives
// the durable config_path itself, so the write stays inside the single-writer transaction.
export type AgentExtensionAddSource =
  | {
      type: 'git';
      url: string;
      ref: string;
      commit_sha?: string;
      source_subpath?: string;
    }
  | {
      type: 'local';
      path: string;
      source_subpath?: string;
    }
  | {
      type: 'direct-attachment';
      skill_markdown: string;
    };

export type AgentExtensionAddRequest = {
  id: string;
  kind: AgentExtensionKind;
  provider_id: AgentExtensionProviderId;
  source: AgentExtensionAddSource;
};

export type AgentExtensionDeleteOptions = {
  // When true, a delete that is blocked by active assignments first removes the
  // extension ID from every agent (atomic assignment write) before deletion.
  removeAssignments?: boolean;
};

export type AgentExtensionReconcileResult = {
  materialized: number;
  repaired: number;
  unavailable: number;
};

// Injectable seams
export type ExtensionExecFile = (
  file: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export type AgentExtensionFsAdapter = {
  readTextFile: (filePath: string) => Promise<string | null>;
  writeTextFileAtomic: (filePath: string, contents: string) => Promise<void>;
  ensureDir: (dirPath: string) => Promise<void>;
  rm: (targetPath: string) => Promise<void>;
  rename: (sourcePath: string, destinationPath: string) => Promise<void>;
  pathExists: (targetPath: string) => Promise<boolean>;
};

export type AgentExtensionMutationSeams = {
  now?: () => string;
  execFile?: ExtensionExecFile;
  fs?: AgentExtensionFsAdapter;
};

export type AgentExtensionReconcileOptions = AgentExtensionMutationSeams;

// --- Per-launch staging (this gate) ---

export type AgentExtensionStageStatus = 'creating' | 'created';

export type AgentExtensionStageEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  display_name: string;
  description: string;
  staged_path: string;
};

export type AgentExtensionStageManifest = {
  schema_version: 1;
  launch_id: string;
  agent_id: AgentExtensionAgentId;
  created_at: string;
  status: AgentExtensionStageStatus;
  entries: AgentExtensionStageEntry[];
};

export type AgentExtensionAvailabilityEntry = {
  id: string;
  kind: 'skill' | 'plugin';
  display_name: string;
  description: string;
  metadata: AgentExtensionRuntimeCatalogEntry['metadata'];
};

export type ResolvedAgentExtensionStage = {
  launchId: string;
  agentId: AgentExtensionAgentId;
  stageDir: string | null;
  launchExtensions:
    | {
        pluginDirs: readonly string[];
        skillDirs: readonly string[];
      }
    | undefined;
  availabilityEntries: readonly AgentExtensionAvailabilityEntry[];
  cleanup: () => Promise<void>;
};

export type CreateAgentExtensionStageOptions = {
  repoRoot: string;
  agentId: AgentExtensionAgentId;
  launchId: string;
  now?: () => string; // ISO timestamp source; matches the predecessor clock-seam type.
  // Defaults to a non-dereferencing recursive copy (fs.cp with recursive: true and
  // verbatimSymlinks: true). Injected in tests to simulate copy failure.
  copyDirectory?: (source: string, destination: string) => Promise<void>;
};
