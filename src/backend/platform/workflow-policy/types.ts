export type PolicyValidationMode =
  | 'lint'
  | 'runtime'
  | 'pre-slice'
  | 'pre-closeout'
  | 'pre-archive'
  | 'queue-advance'
  | 'ci'
  | 'activation-bootstrap';

export type PolicyOutputFormat = 'text' | 'json';

export type PolicyStatus = 'ok' | 'report-only-violations' | 'blocked';

export type PolicyPhase = 'fail-closed' | 'report-only';

export type ViolationSeverity = 'error' | 'warning';

export type GuardrailStatus = 'not-requested' | 'allowed' | 'denied';

export interface Violation {
  rule_id: string;
  severity: ViolationSeverity | string;
  transition: string;
  artifact: string;
  message: string;
  remediation: string;
}

export interface GuardrailResult {
  status: GuardrailStatus | string;
  requested_agent_id: string;
  resolved_agent_id: string;
  expected_agent_id: string;
  expected_source: string;
  validator_mode: string;
  launch_seam: string;
  required_model: string;
  active_model: string;
  violations: Violation[];
}

export interface PolicyResult {
  status: PolicyStatus | string;
  mode: string;
  phase: PolicyPhase | string;
  rule_count: number;
  failure_count: number;
  warning_count: number;
  violations: Violation[];
  next_steps: string[];
  guardrail: GuardrailResult | null;
}

export interface WorkspaceArtifact {
  relativePath: string;
  exists: boolean;
  sections: Record<string, string[]>;
  metadata: Record<string, string>;
  taskLineage: Record<string, string>;
  hasSubstantiveContent: boolean;
}

export interface NamedAgentRecord {
  role: string;
  name: string;
  instructionPath: string;
  agentProfilePath: string;
  workflowOrder: number;
  expectedInstructionHeading: string;
  expectedAgentIdentity: string;
  requiredModel: string;
}

export type NamedAgentTeam = Record<string, NamedAgentRecord>;

export interface AgentProfileParseResult {
  frontmatter: Record<string, string>;
  name?: string;
  description?: string;
  model?: string;
  body: string;
  errors: string[];
}
