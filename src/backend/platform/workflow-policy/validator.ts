import path from 'node:path';
import { readTextFile, resolvePaths } from '../core/index.js';
import { loadNamedAgentTeam } from './agents.js';
import {
  inferContextPackDir,
  loadWorkspaceArtifact,
  parseSections,
  resolveSemanticSection,
} from './artifacts.js';
import {
  AGENT_REGISTRY_RELATIVE_PATH,
  FAIL_CLOSED_DEFAULT_MODES,
  FINAL_SUMMARY_RELATIVE_PATH,
  HANDOFF_RELATIVE_PATHS,
  RETROSPECTIVE_INPUT_RELATIVE_PATH,
  SLICE_REQUIRED_SECTION_SPECS,
  countFailures,
  countWarnings,
  createViolation,
  sortViolations,
} from './models.js';

/**
 * Returns a stable bare-filename key from any relative path.
 *
 * toHandoffKey('professional-task.md')
 *   → 'professional-task.md'
 */
export function toHandoffKey(relative: string): string {
  return path.basename(relative);
}
import {
  agentIdExists,
  normalizeAgentId,
  normalizeText,
  readAgentIdFromSection,
} from './matching.js';
import {
  retrospectiveCompletionGaps,
  type RetrospectiveGaps,
} from './rules/retrospectiveHelpers.js';
import { DEFAULT_RULE_EVALUATORS } from './defaultEvaluators.js';
import type {
  GuardrailResult,
  NamedAgentTeam,
  PolicyPhase,
  PolicyResult,
  PolicyValidationMode,
  Violation,
  WorkspaceArtifact,
} from './types.js';

export const FULL_EVALUATION_SEQUENCE = [
  'namedAgentRules',
  'boundaryRules',
  'requiredTaskArtifacts',
  'artifactAgentIdRules',
  'workflowPathRules',
  'transitionLegalityRules',
  'closeoutRules',
  'sliceQualityRules',
  'specQualityRules',
  'taskQualityRules',
  'queueRules',
  'intakeQualityRules',
  'planningAgentRules',
  'qaExecutionRules',
  'templateStructureRules',
  'parallelOkContentRules',
  'bootstrapRules',
] as const;

export const LIGHTWEIGHT_EVALUATION_SEQUENCE = [
  'namedAgentRules',
  'closeoutRules',
  'queueRules',
] as const;

export type PolicyRuleName =
  | (typeof FULL_EVALUATION_SEQUENCE)[number]
  | (typeof LIGHTWEIGHT_EVALUATION_SEQUENCE)[number];

export type PolicyRuleEvaluator = (validator: PolicyValidator) => void | Promise<void>;

export type PolicyRuleEvaluatorRegistry = Partial<Record<PolicyRuleName, PolicyRuleEvaluator>>;

export type GuardrailExpectationResolver = (
  validator: PolicyValidator,
) => { expectedAgentId: string; expectedSource: string } | Promise<{ expectedAgentId: string; expectedSource: string }>;

export interface PolicyValidatorOptions {
  rootDir: string;
  mode: PolicyValidationMode;
  taskId?: string;
  contextPackDir?: string;
  enforce?: boolean;
  requestedAgentId?: string;
  ruleEvaluators?: PolicyRuleEvaluatorRegistry;
  resolveExpectedRuntimeAgent?: GuardrailExpectationResolver;
}

const NOOP_RULE_EVALUATOR: PolicyRuleEvaluator = () => {};

export class PolicyValidator {
  readonly rootDir: string;
  readonly mode: PolicyValidationMode;
  readonly enforce: boolean;
  readonly phase: PolicyPhase;
  readonly requestedAgentId: string;

  private readonly _taskId: string | undefined;
  private readonly requestedContextPackDir?: string;
  private readonly ruleEvaluators: PolicyRuleEvaluatorRegistry;
  private readonly resolveExpectedRuntimeAgent?: GuardrailExpectationResolver;

  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  private artifacts = new Map<string, WorkspaceArtifact>();
  private namedAgentTeamInternal: NamedAgentTeam = {};
  private namedAgentRegistryErrorsInternal: string[] = [];
  private evaluatedRulesInternal = new Set<string>();
  private violationsInternal: Violation[] = [];
  private resolvedContextPackDir: string | null = null;

  constructor(options: PolicyValidatorOptions) {
    this.rootDir = options.rootDir;
    this.mode = options.mode;
    this._taskId = options.taskId;
    this.enforce = options.enforce ?? FAIL_CLOSED_DEFAULT_MODES.has(options.mode);
    this.phase = this.enforce ? 'fail-closed' : 'report-only';
    this.requestedContextPackDir = options.contextPackDir;
    this.requestedAgentId = normalizeAgentId(options.requestedAgentId ?? '');
    this.ruleEvaluators = { ...DEFAULT_RULE_EVALUATORS, ...(options.ruleEvaluators ?? {}) };
    this.resolveExpectedRuntimeAgent = options.resolveExpectedRuntimeAgent;
  }

  /** The taskId passed at construction time, if any. */
  get taskId(): string | undefined {
    return this._taskId;
  }

  /**
   * The per-task handoffs directory: AgentWorkSpace/tasks/<taskId>/handoffs.
   * Throws in lint mode (no taskId) because task context is required.
   */
  get handoffsDir(): string {
    if (!this._taskId) {
      throw new Error('task context required; activate a pending item before validation');
    }
    return resolvePaths({ repoRoot: this.rootDir, taskId: this._taskId }).handoffs;
  }

  /**
   * The per-task ImplementationSteps directory: AgentWorkSpace/tasks/<taskId>/ImplementationSteps.
   * Throws in lint mode (no taskId) because task context is required.
   */
  get implementationStepsDir(): string {
    if (!this._taskId) {
      throw new Error('task context required; activate a pending item before validation');
    }
    return resolvePaths({ repoRoot: this.rootDir, taskId: this._taskId }).implementationSteps;
  }

  get namedAgentTeam(): NamedAgentTeam {
    this.requireInitialized();
    return this.namedAgentTeamInternal;
  }

  get namedAgentRegistryErrors(): string[] {
    this.requireInitialized();
    return [...this.namedAgentRegistryErrorsInternal];
  }

  get evaluatedRules(): ReadonlySet<string> {
    return this.evaluatedRulesInternal;
  }

  get violations(): readonly Violation[] {
    return this.violationsInternal;
  }

  get contextPackDir(): string | null {
    this.requireInitialized();
    return this.resolvedContextPackDir;
  }

  async initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeInternal();
    }
    await this.initializePromise;
  }

  private async initializeInternal(): Promise<void> {
    const handoffsDir = this.handoffsDir;
    const loadedArtifacts = await Promise.all(
      HANDOFF_RELATIVE_PATHS.map(async (fullRelativePath) => {
        const bareKey = toHandoffKey(fullRelativePath);
        const loaded = await this.loadHandoffArtifact(
          handoffsDir, bareKey,
        );
        // Override relativePath to the stable bare-filename key so that rule code
        // that sets artifact: artifact.relativePath produces a bare-filename violation.
        const artifact = { ...loaded, relativePath: bareKey };
        return [bareKey, artifact] as const;
      }),
    );

    for (const [bareKey, artifact] of loadedArtifacts) {
      this.artifacts.set(bareKey, artifact);
    }

    const namedAgentTeam = await loadNamedAgentTeam(this.rootDir);
    this.namedAgentTeamInternal = namedAgentTeam.team;
    this.namedAgentRegistryErrorsInternal = namedAgentTeam.errors;
    this.resolvedContextPackDir = await inferContextPackDir(this.rootDir, this.requestedContextPackDir);
    this.initialized = true;
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error('PolicyValidator must be initialized before reading loaded state.');
    }
  }

  async getArtifact(key: string): Promise<WorkspaceArtifact> {
    await this.initialize();
    // Normalize to bare-filename key: 'foo.md' → 'foo.md' (idempotent).
    const bareKey = toHandoffKey(key);
    const cached = this.artifacts.get(bareKey);
    if (cached) {
      return cached;
    }

    const artifact = await this.loadHandoffArtifact(
      this.handoffsDir, bareKey,
    );
    this.artifacts.set(bareKey, artifact);
    return artifact;
  }

  private async loadHandoffArtifact(
    handoffsDir: string, bareKey: string,
  ): Promise<WorkspaceArtifact> {
    const primaryRelative = path.relative(
      this.rootDir, path.join(handoffsDir, bareKey),
    );
    return loadWorkspaceArtifact(this.rootDir, primaryRelative);
  }

  recordRule(ruleId: string): void {
    this.evaluatedRulesInternal.add(ruleId);
  }

  addViolation(input: {
    rule_id: string;
    artifact: string;
    message: string;
    remediation: string;
    severity?: Violation['severity'];
  }): void {
    this.recordRule(input.rule_id);
    this.violationsInternal.push(createViolation({
      rule_id: input.rule_id,
      severity: input.severity ?? 'error',
      transition: this.mode,
      artifact: input.artifact,
      message: input.message,
      remediation: input.remediation,
    }));
  }

  taskIdsByArtifact(): Record<string, string> {
    this.requireInitialized();
    const taskIds: Record<string, string> = {};
    for (const [relativePath, artifact] of this.artifacts.entries()) {
      const taskId = artifact.metadata['Task ID']?.trim();
      if (taskId) {
        taskIds[relativePath] = taskId;
      }
    }
    return taskIds;
  }

  hasActiveTask(): boolean {
    this.requireInitialized();
    if (Object.keys(this.taskIdsByArtifact()).length > 0) {
      return true;
    }
    return this.artifacts.get('professional-task.md')?.hasSubstantiveContent ?? false;
  }

  workspaceIsReset(): boolean {
    this.requireInitialized();
    if (Object.keys(this.taskIdsByArtifact()).length > 0) {
      return false;
    }
    return [...this.artifacts.values()].every((artifact) => !artifact.hasSubstantiveContent);
  }

  finalSummaryIsComplete(): boolean {
    this.requireInitialized();
    return this.artifacts.get(toHandoffKey(FINAL_SUMMARY_RELATIVE_PATH))?.hasSubstantiveContent ?? false;
  }

  buildNextSteps(): string[] {
    this.requireInitialized();
    if (this.violationsInternal.length === 0) {
      if (!this.hasActiveTask()) {
        return [
          'No active task was detected; task-workspace rules were skipped.',
          'If you are about to start work, activate the next pending item first to create the per-task handoffs directory.',
        ];
      }
      return ['No workflow-policy violations were detected for the current mode.'];
    }

    const ordered: string[] = [];
    for (const violation of this.violationsInternal) {
      if (!ordered.includes(violation.remediation)) {
        ordered.push(violation.remediation);
      }
    }
    return ordered;
  }

  async sliceArtifactIsParallelReady(
    slicePath: string,
  ): Promise<{ ready: boolean; missingSections: string[]; sliceId: string }> {
    const text = (await readTextFile(slicePath)) ?? '';
    const sections = parseSections(text);
    const missingSections = SLICE_REQUIRED_SECTION_SPECS
      .filter((sectionSpec) => (
        normalizeText(resolveSemanticSection(sections, sectionSpec).content).length === 0
      ))
      .map((sectionSpec) => sectionSpec.preferredHeading);

    return {
      ready: missingSections.length === 0,
      missingSections: [...missingSections],
      sliceId: slicePath.replace(/^.*\//, '').replace(/\.md$/, ''),
    };
  }

  transitionRuleSeverity(): Violation['severity'] {
    if (this.mode === 'lint' && !this.requestedAgentId) {
      return 'warning';
    }
    if (this.mode === 'pre-archive' || this.mode === 'queue-advance') {
      return 'warning';
    }
    return 'error';
  }

  validateAgentIdSection(input: {
    artifact: WorkspaceArtifact;
    sectionName: string;
    ruleId: string;
    missingMessage: string;
    invalidMessage: string;
    remediation: string;
    severity?: Violation['severity'];
  }): string {
    const agentId = normalizeAgentId(normalizeText(input.artifact.sections[input.sectionName] ?? []));
    if (!agentId) {
      this.addViolation({
        rule_id: input.ruleId,
        artifact: input.artifact.relativePath,
        severity: input.severity ?? 'warning',
        message: input.missingMessage,
        remediation: input.remediation,
      });
      return '';
    }

    if (!agentIdExists(agentId, this.namedAgentTeamInternal)) {
      this.addViolation({
        rule_id: input.ruleId,
        artifact: input.artifact.relativePath,
        severity: input.severity ?? 'warning',
        message: input.invalidMessage.replace('{agent_id}', agentId),
        remediation: input.remediation,
      });
      return '';
    }

    return agentId;
  }

  readAgentIdSection(artifact: WorkspaceArtifact, sectionName: string): string {
    return readAgentIdFromSection(artifact.sections, sectionName);
  }

  /**
   * Returns contribution section `[agentId, sectionName]` pairs ordered by
   * workflow_order, mirroring Python's `retrospective_contribution_sections()`.
   */
  retrospectiveContributionSections(): ReadonlyArray<readonly [string, string]> {
    this.requireInitialized();
    const ordered = Object.entries(this.namedAgentTeamInternal).sort(
      ([, a], [, b]) => a.workflowOrder - b.workflowOrder || 0,
    );
    return ordered.map(([agentId, agent]) => [
      agentId,
      `${agent.name}'s Contribution (${agent.role})`,
    ] as const);
  }

  /**
   * Returns whether a full retrospective ceremony is required.
   * Falls back to the `Retrospective Required` metadata field when no
   * context-pack counter is available (safest default: true).
   */
  isFullRetrospectiveRequired(): boolean {
    this.requireInitialized();
    // No TaskCompletionCounter port yet — fall back to metadata.
    const retro = this.artifacts.get(toHandoffKey(RETROSPECTIVE_INPUT_RELATIVE_PATH));
    if (retro?.exists) {
      const field = (retro.metadata['Retrospective Required'] ?? '').trim().toLowerCase();
      if (field === 'false') {
        return false;
      }
      if (field === 'true') {
        return true;
      }
    }
    return true;
  }

  /**
   * Compute retrospective completion gaps by delegating to the shared helper.
   * Mirrors Python's `PolicyValidator.retrospective_completion_gaps()`.
   */
  retrospectiveCompletionGaps(fullCeremony?: boolean): RetrospectiveGaps {
    this.requireInitialized();
    const ceremony = fullCeremony ?? this.isFullRetrospectiveRequired();
    const retroArtifact = this.artifacts.get(toHandoffKey(RETROSPECTIVE_INPUT_RELATIVE_PATH)) ?? {
      relativePath: RETROSPECTIVE_INPUT_RELATIVE_PATH,
      exists: false,
      sections: {},
      metadata: {},
      taskLineage: {},
      hasSubstantiveContent: false,
    };
    return retrospectiveCompletionGaps({
      retrospective: retroArtifact,
      fullCeremony: ceremony,
      contributionSections: this.retrospectiveContributionSections(),
    });
  }

  /**
   * Infer the expected next agent by calling the injected resolver.
   * Mirrors Python's `infer_requested_runtime_agent()`.
   */
  async inferExpectedRuntimeAgent(): Promise<{ expectedAgentId: string; expectedSource: string }> {
    if (!this.resolveExpectedRuntimeAgent) {
      return { expectedAgentId: '', expectedSource: '' };
    }
    return this.resolveExpectedRuntimeAgent(this);
  }

  private async invokeRule(ruleName: PolicyRuleName): Promise<void> {
    const evaluator = this.ruleEvaluators[ruleName] ?? NOOP_RULE_EVALUATOR;
    await evaluator(this);
  }

  async buildGuardrailResult(): Promise<GuardrailResult | null> {
    await this.initialize();

    if (this.mode !== 'runtime' && !this.requestedAgentId) {
      return null;
    }

    let expectedAgentId = '';
    let expectedSource = '';
    if (!this.namedAgentRegistryErrorsInternal.length && this.hasActiveTask() && this.resolveExpectedRuntimeAgent) {
      const resolved = await this.resolveExpectedRuntimeAgent(this);
      expectedAgentId = resolved.expectedAgentId;
      expectedSource = resolved.expectedSource;
    }

    const requestedAgent = this.namedAgentTeamInternal[this.requestedAgentId];
    const guardrailViolations = this.violationsInternal.filter((violation) => (
      violation.rule_id.startsWith('runtime.')
      || violation.rule_id.startsWith('guardrail.')
    ));

    if (this.requestedAgentId && !requestedAgent) {
      guardrailViolations.push(createViolation({
        rule_id: 'guardrail.unknown-agent-id',
        severity: 'error',
        transition: this.mode,
        artifact: AGENT_REGISTRY_RELATIVE_PATH,
        message: `Requested agent ID "${this.requestedAgentId}" is not in the agent registry.`,
        remediation: `Use a valid agent_id from ${AGENT_REGISTRY_RELATIVE_PATH}.`,
      }));
    }

    let status: GuardrailResult['status'] = 'allowed';
    if (!this.requestedAgentId) {
      status = 'not-requested';
    } else if (guardrailViolations.some((violation) => violation.severity === 'error')) {
      status = 'denied';
    }

    return {
      status,
      requested_agent_id: this.requestedAgentId,
      resolved_agent_id: this.requestedAgentId,
      expected_agent_id: expectedAgentId,
      expected_source: expectedSource,
      validator_mode: this.mode,
      launch_seam: 'workflow-policy-validator',
      required_model: requestedAgent?.requiredModel ?? '',
      active_model: '',
      violations: guardrailViolations,
    };
  }

  async evaluate(): Promise<PolicyResult> {
    await this.initialize();

    const sequence = this.mode === 'pre-closeout' || this.mode === 'queue-advance'
      ? LIGHTWEIGHT_EVALUATION_SEQUENCE
      : FULL_EVALUATION_SEQUENCE;

    for (const ruleName of sequence) {
      await this.invokeRule(ruleName);
    }

    this.violationsInternal = sortViolations(this.violationsInternal);
    const failureCount = countFailures(this.violationsInternal);
    const warningCount = countWarnings(this.violationsInternal);

    let status: PolicyResult['status'] = 'ok';
    if (failureCount > 0 && this.enforce) {
      status = 'blocked';
    } else if (this.violationsInternal.length > 0) {
      status = 'report-only-violations';
    }

    return {
      status,
      mode: this.mode,
      phase: this.phase,
      rule_count: this.evaluatedRulesInternal.size,
      failure_count: failureCount,
      warning_count: warningCount,
      violations: [...this.violationsInternal],
      next_steps: this.buildNextSteps(),
      guardrail: await this.buildGuardrailResult(),
    };
  }
}
