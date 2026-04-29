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
};

export type ProviderFrontendDescriptor = {
  providerId: string;
  homeDirName: string;
  registryPath: string;
  agentConfigPaths: ProviderAgentConfigPaths;
  promptPathEnvVars: { handoffsDir: string; implStepsDir: string };
  contextPackEnvVars: { paths: string; searchRoots: string };
  roster: ProviderFrontendRosterEntry[];
};
