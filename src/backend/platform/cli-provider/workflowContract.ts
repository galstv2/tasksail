// Provider-neutral platform contract for the supervised workflow pipeline.
//
// Every CLI provider runs THESE four roles and declares THESE registry field
// keys, regardless of which CLI backs it. Only the VALUES — agent profile
// paths, instruction paths, the CLI binary, flags, env, and profile file format —
// are provider-specific, and those live behind the CliProvider interface.
//
// Shared code (workflow-policy, agent-runner) must reference these constants
// instead of hardcoding the literals, so a new provider that conforms to the
// contract needs ZERO edits to shared code.
//
// Keep this module dependency-free (pure constants) so cli-provider, agent-runner,
// and workflow-policy can all import it without creating an import cycle.

/** The fixed workflow roles, in pipeline order: Planning → PM → SWE → QA. */
export const PLANNER_ROLE_ID = 'planning-agent';
export const PRODUCT_MANAGER_ROLE_ID = 'product-manager';
export const SOFTWARE_ENGINEER_ROLE_ID = 'software-engineer';
export const QA_ROLE_ID = 'qa';

export const WORKFLOW_ROLE_IDS = [
  PLANNER_ROLE_ID,
  PRODUCT_MANAGER_ROLE_ID,
  SOFTWARE_ENGINEER_ROLE_ID,
  QA_ROLE_ID,
] as const;

export type WorkflowRoleId = (typeof WORKFLOW_ROLE_IDS)[number];

/** Set form for membership checks in shared validation code. */
export const WORKFLOW_ROLE_ID_SET: ReadonlySet<string> = new Set(WORKFLOW_ROLE_IDS);

/**
 * Canonical registry field keys every provider's registry.json must declare.
 * The VALUES are provider-specific paths; the KEYS are the platform contract.
 * Each maps to a typed slot on AgentProfile (instructionPath / agentProfilePath).
 */
export const REGISTRY_FIELD_INSTRUCTION_PATH = 'instruction_path';
export const REGISTRY_FIELD_AGENT_PROFILE_PATH = 'agent_profile_path';

export const REQUIRED_REGISTRY_FIELDS = [
  REGISTRY_FIELD_INSTRUCTION_PATH,
  REGISTRY_FIELD_AGENT_PROFILE_PATH,
] as const;
