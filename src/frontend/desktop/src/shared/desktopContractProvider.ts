export const PROVIDER_DESCRIBE_ACTIVE_CHANNEL = 'provider:describe-active';

export type ProviderAgentConfigPaths = {
  root: string;
  instructions: string;
  globalInstructions?: string | null;
  prompts: string;
  profiles: string;
  registry: string;
};

export type ProviderFrontendRosterEntry = {
  agentId: string;
  roleName: string;
  humanName: string;
  workflowOrder: number;
  roleKind: RoleKind | null;
};

export type RoleKind = 'planner' | 'pm' | 'builder' | 'verifier' | 'qa';

export type ProviderFrontendDescriptor = {
  providerId: string;
  cliDisplayName: string;
  homeDirName: string;
  registryPath: string;
  agentConfigPaths: ProviderAgentConfigPaths;
  promptPathEnvVars: { handoffsDir: string; implStepsDir: string };
  contextPackEnvVars: { paths: string; searchRoots: string };
  roster: ProviderFrontendRosterEntry[];
  plannerAgentId: string | null;
};
