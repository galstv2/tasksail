import type {
  GuardrailResult,
  NamedAgentRecord,
  PolicyOutputFormat,
  PolicyResult,
  PolicyValidationMode,
  Violation,
  WorkspaceArtifact,
} from './types.js';

export const SECTION_HEADING = /^##\s+(.*\S)\s*$/;
export const METADATA_LINE = /^-\s+([^:]+):\s*(.*)$/;
export const FRONTMATTER_LINE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
export const AGENT_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

export const MODE_CHOICES = [
  'lint',
  'runtime',
  'pre-slice',
  'pre-closeout',
  'pre-archive',
  'queue-advance',
  'ci',
  'activation-bootstrap',
] as const satisfies readonly PolicyValidationMode[];

export const OUTPUT_CHOICES = ['text', 'json'] as const satisfies readonly PolicyOutputFormat[];

export const FAIL_CLOSED_DEFAULT_MODES = new Set<PolicyValidationMode>([
  'runtime',
  'pre-slice',
  'pre-closeout',
  'pre-archive',
  'queue-advance',
  'ci',
  'activation-bootstrap',
]);

export const GUARDED_TRANSITION_MODES = new Set<PolicyValidationMode>([
  'runtime',
  'pre-slice',
  'pre-archive',
  'queue-advance',
]);

export const ALLOWED_SYSTEM_LAYERS = new Set([
  'backend',
  'frontend',
  'infrastructure',
  'database',
  'documents',
  'shared',
]);

export const RETROSPECTIVE_INPUT_RELATIVE_PATH = 'AgentWorkSpace/handoffs/retrospective-input.md';

export const HANDOFF_RELATIVE_PATHS = [
  'AgentWorkSpace/handoffs/professional-task.md',
  'AgentWorkSpace/handoffs/implementation-spec.md',
  RETROSPECTIVE_INPUT_RELATIVE_PATH,
  'AgentWorkSpace/handoffs/final-summary.md',
  'AgentWorkSpace/handoffs/issues.md',
] as const;

export const CONTENT_SECTION_EXCLUSIONS = new Set([
  'Task Metadata',
  'Task Lineage',
  'Difficulty Assessment',
]);

export const ACTIVE_ITEM_RELATIVE_PATH = 'AgentWorkSpace/pendingitems/.active-item';
export const AGENT_MODEL_CATALOG_RELATIVE_PATH = 'config/agent-model-catalog.default.json';
export const AGENT_REGISTRY_RELATIVE_PATH = '.github/agents/registry.json';

export const REQUIRED_AGENT_REGISTRY_FIELDS = new Set([
  'agent_id',
  'role_name',
  'human_name',
  'instruction_path',
  'agent_profile_path',
  'autonomy_profile',
  'workflow_order',
]);

export const SLICE_REQUIRED_SECTIONS = [
  'Purpose',
  'Depends On',
  'Scope',
  'Files',
  'Acceptance Criteria',
  'Unit Tests',
  'Validation Commands',
  'Guards',
] as const;

export const ISSUES_MD_RELATIVE_PATH = 'AgentWorkSpace/handoffs/issues.md';
export const FINAL_SUMMARY_RELATIVE_PATH = 'AgentWorkSpace/handoffs/final-summary.md';

// ---------------------------------------------------------------------------
// Difficulty levels
// ---------------------------------------------------------------------------
export const ALLOWED_DIFFICULTY_LEVELS = new Set(['Easy', 'Medium', 'Hard']);

// ---------------------------------------------------------------------------
// Retrospective
// ---------------------------------------------------------------------------
export const RETROSPECTIVE_REQUIRED_CONTENT_SECTIONS = [
  'Retrospective Summary',
  'What Went Well',
  'What Could Have Gone Better',
] as const;
export const RETROSPECTIVE_ACTION_ITEMS_SECTION = 'Action Items';
export const RETROSPECTIVE_CONTRIBUTION_MAX_BULLETS = 5;
export const RETROSPECTIVE_ACTION_ITEMS_MAX_BULLETS = 5;

// ---------------------------------------------------------------------------
// Slice quality
// ---------------------------------------------------------------------------
export const SLICE_RECOMMENDED_SECTIONS: readonly string[] = [];
export const SLICE_FILE_SECTIONS = ['Files'] as const;

// ---------------------------------------------------------------------------
// Spec quality
// ---------------------------------------------------------------------------
export const SPEC_REQUIRED_SECTIONS = [
  'Problem Statement',
  'Goals',
  'Non-Goals',
  'Architecture Summary',
  'Touched Systems',
  'Change Boundaries',
  'Dependency Analysis',
  'Codebase Analysis',
  'Proposed Structure',
  'Validation Strategy',
  'Files or Areas Likely to Change',
] as const;

export const SPEC_RECOMMENDED_SECTIONS = [
  'Contracts',
  'Migrations or Data Implications',
  'Risks',
  'Test Coverage',
  'Impact Assessment',
] as const;

// ---------------------------------------------------------------------------
// Task quality
// ---------------------------------------------------------------------------
export const TASK_REQUIRED_SECTIONS = [
  'Problem Statement',
  'Business Goal',
  'Scope',
  'Non-Goals',
  'Acceptance Criteria',
] as const;

export const TASK_RECOMMENDED_SECTIONS = [
  'Constraints',
  'Risks',
  'Open Questions',
] as const;

export const CHILD_TASK_REQUIRED_LINEAGE_FIELDS = [
  'Parent Task ID',
  'Root Task ID',
  'Parent QMD Record ID',
  'Parent QMD Scope',
  'Follow-Up Reason',
] as const;

export const LINEAGE_CONSISTENCY_FIELDS = [
  'Parent Task ID',
  'Root Task ID',
  'Parent QMD Record ID',
  'Parent QMD Scope',
] as const;

// ---------------------------------------------------------------------------
// Intake quality
// ---------------------------------------------------------------------------
export const INTAKE_REQUIRED_SECTIONS = [
  'Request Summary',
  'Desired Outcome',
  'Acceptance Signals',
] as const;

export const INTAKE_RECOMMENDED_SECTIONS = [
  'Constraints',
  'Suggested Routing',
] as const;

export const INTAKE_CHILD_TASK_REQUIRED_LINEAGE_FIELDS = [
  'Parent Task ID',
  'Root Task ID',
  'Follow-Up Reason',
] as const;

export const INTAKE_CHILD_TASK_REQUIRED_SECTIONS = [
  'Parent Task Carry-Forward Summary',
] as const;

export const INTAKE_REQUEST_SUMMARY_MIN_LENGTH = 20;

// ---------------------------------------------------------------------------
// QA issues
// ---------------------------------------------------------------------------
export const ALLOWED_ISSUE_SEVERITIES = new Set(['blocking', 'advisory']);
export const ALLOWED_FINDING_TYPES = new Set([
  'code-review',
  'test-gap',
  'security',
  'hygiene',
  'release-risk',
]);
export const ISSUES_MD_REQUIRED_FINDING_SECTIONS = [
  'Severity',
  'Finding Type',
  'Required Fix',
] as const;
export const ISSUES_MD_ROUTING_AGENT_SECTIONS = [
  'Remediation Owner Agent ID',
  'Revalidation Agent ID',
  'Return-To Agent ID',
] as const;
export const REMEDIATION_BLOCKING_LOCATION_PATTERN =
  /(?:[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-.]+|[a-zA-Z0-9_\-]+\.(?:py|ts|tsx|js|jsx|sh|md|yml|yaml|json|toml|cfg))/;

export function isPolicyValidationMode(value: string): value is PolicyValidationMode {
  return MODE_CHOICES.includes(value as PolicyValidationMode);
}

export function createViolation(input: Violation): Violation {
  return {
    rule_id: input.rule_id,
    severity: input.severity,
    transition: input.transition,
    artifact: input.artifact,
    message: input.message,
    remediation: input.remediation,
  };
}

export function cloneWorkspaceArtifact(artifact: WorkspaceArtifact): WorkspaceArtifact {
  return {
    relativePath: artifact.relativePath,
    exists: artifact.exists,
    sections: Object.fromEntries(
      Object.entries(artifact.sections).map(([sectionName, lines]) => [sectionName, [...lines]]),
    ),
    metadata: { ...artifact.metadata },
    taskLineage: { ...artifact.taskLineage },
    hasSubstantiveContent: artifact.hasSubstantiveContent,
  };
}

export function sortViolations(violations: readonly Violation[]): Violation[] {
  return [...violations].sort((left, right) => (
    left.rule_id.localeCompare(right.rule_id)
    || left.artifact.localeCompare(right.artifact)
    || left.message.localeCompare(right.message)
  ));
}

export function countFailures(violations: readonly Violation[]): number {
  return violations.filter((violation) => violation.severity === 'error').length;
}

export function countWarnings(violations: readonly Violation[]): number {
  return violations.filter((violation) => violation.severity !== 'error').length;
}

export function guardrailResultToJSON(result: GuardrailResult): Record<string, unknown> {
  return {
    status: result.status,
    requested_agent_id: result.requested_agent_id,
    resolved_agent_id: result.resolved_agent_id,
    expected_agent_id: result.expected_agent_id,
    expected_source: result.expected_source,
    validator_mode: result.validator_mode,
    launch_seam: result.launch_seam,
    required_model: result.required_model,
    active_model: result.active_model,
    violations: result.violations.map(createViolation),
  };
}

export function policyResultToJSON(result: PolicyResult): Record<string, unknown> {
  return {
    status: result.status,
    mode: result.mode,
    phase: result.phase,
    rule_count: result.rule_count,
    failure_count: result.failure_count,
    warning_count: result.warning_count,
    violations: result.violations.map(createViolation),
    next_steps: [...result.next_steps],
    guardrail: result.guardrail ? guardrailResultToJSON(result.guardrail) : null,
  };
}

export function createNamedAgentRecord(input: NamedAgentRecord): NamedAgentRecord {
  return {
    role: input.role,
    name: input.name,
    instructionPath: input.instructionPath,
    agentProfilePath: input.agentProfilePath,
    workflowOrder: input.workflowOrder,
    expectedInstructionHeading: input.expectedInstructionHeading,
    expectedAgentIdentity: input.expectedAgentIdentity,
    requiredModel: input.requiredModel,
  };
}
