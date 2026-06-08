// Hand-written TS interfaces mirroring backend pack_schemas dataclasses.
// Keep these in sync with the Python shapes.

export interface ManifestRepository {
  repo_id: string;
  repo_name: string;
  local_paths: string[];
  system_layer: string;
  default_focusable: boolean;
  activation_priority: number;
  repository_type: string;
  /** @deprecated Superseded by repository_type; kept for backward compatibility. */
  repo_role: string;
  languages?: string[];
  artifact_roots?: string[];
  document_paths?: string[];
  owner?: string;
  bounded_context?: string;
  service_name?: string;
  workspace_activation_group?: string;
  depends_on_repo_ids?: string[];
  used_by_repo_ids?: string[];
  adjacent_repo_ids?: string[];
  exposes_services?: string[];
  consumes_services?: string[];
  owns_domains?: string[];
  integration_points?: string[];
}

export interface LocalPath {
  host: string;
  container?: string | null;
  git_root?: string | null;
}

export type LocalPathInput = string | LocalPath;

/** v2 repository entry — extends v1 with orthogonal category/focus axes. */
export interface ManifestRepositoryV2 extends Omit<ManifestRepository, 'local_paths'> {
  local_paths: LocalPath[];
  /** Primary focus: 'primary' | 'support'. Replaces repository_type as the focus axis. */
  repo_focus?: string;
  /** True when repo_focus was explicitly authored by the operator (not inferred). */
  repo_focus_authored?: boolean;
  /** Category classification: service | application | frontend | library | infrastructure | data | documentation | tool | unknown. */
  repo_category?: string;
  /** True when repo_category was explicitly authored by the operator (not inferred). */
  repo_category_authored?: boolean;
}

export interface ManifestFocusableArea {
  focus_id: string;
  focus_name: string;
  focus_type: string;
  relative_path: string;
  group?: string;
  adjacent_focus_area_ids?: string[];
  workspace_activation_group?: string;
  default_focusable?: boolean;
  activation_priority?: number;
  repository_type?: string;
}

/** v1 manifest — uses untyped repository_type field on each repo. */
export interface RepoSourcesManifestV1 {
  manifest_version: string;
  manifest_status: string;
  estate_type: string;
  context_pack_id: string;
  qmd_scope_root: string;
  primary_working_repo_ids: string[];
  primary_focus_area_ids: string[];
  repositories?: ManifestRepository[];
  focusable_areas?: ManifestFocusableArea[];
  repository?: ManifestRepository & { local_paths?: string[] };
  approved_at?: string;
  display_name?: string;
  default_scope_mode?: string;
  approval_source?: Record<string, unknown>;
  shared_glossary_terms?: string[];
}

/** v2 manifest — same top-level structure as v1; repository entries carry repo_category + repo_focus. */
export interface RepoSourcesManifestV2 extends Omit<RepoSourcesManifestV1, 'repositories' | 'repository'> {
  repositories?: ManifestRepositoryV2[];
  repository?: ManifestRepositoryV2 & { local_paths?: LocalPath[] };
}

/**
 * Union of v1 and v2 manifest shapes. Use this type for all manifest reads.
 * Narrowing: check `manifest_version === 'qmd-repo-sources/v2'` to access v2-only repo fields.
 */
export type RepoSourcesManifest = RepoSourcesManifestV1 | RepoSourcesManifestV2;

export const MANIFEST_REQUIRED_FIELDS = [
  'manifest_version',
  'manifest_status',
  'estate_type',
  'context_pack_id',
  'qmd_scope_root',
  'primary_working_repo_ids',
  'primary_focus_area_ids',
] as const;

export type ManifestRequiredKey = (typeof MANIFEST_REQUIRED_FIELDS)[number];

export interface BootstrapRepository {
  repo_id: string;
  repo_name: string;
  repo_root: string;
  system_layer: string;
  owner: string;
  /** @deprecated Superseded by repository_type; kept for backward compatibility. */
  repo_role: string;
  repository_type: string | null;
  languages: string[];
  artifact_roots: string[];
  document_paths: string[];
  bounded_context: string;
  service_name: string;
  workspace_activation_group: string;
  default_focusable: boolean;
  activation_priority: number;
  adjacent_repo_ids: string[];
  depends_on_repo_ids: string[];
  used_by_repo_ids: string[];
}

export interface BootstrapAnswers {
  questionnaire_version: string;
  captured_at: string;
  context_pack_id: string;
  estate_name: string;
  repository_count: number;
  default_scope_mode: string;
  discovery_mode: string;
  estate_type: string;
  primary_working_repo_ids: string[];
  primary_focus_area_ids: string[];
  focusable_areas: unknown[];
  repositories: BootstrapRepository[];
}

export const ANSWERS_REQUIRED_FIELDS = [
  'questionnaire_version',
  'context_pack_id',
  'estate_name',
  'repositories',
] as const;

export type AnswersRequiredKey = (typeof ANSWERS_REQUIRED_FIELDS)[number];

// SeedPlan
export interface SeedPlanQmdTargets {
  canonical_repo_summary?: string;
  operational_bootstrap_note?: string;
  estate_partition?: string;
  language_partitions?: string[];
  bounded_context_summary?: string;
  documents_partition?: string;
}

export interface SeedPlanRepository {
  repo_id: string;
  repo_name: string;
  owner: string | null;
  bounded_context: string | null;
  system_layer: string;
  status: string;
  languages: string[];
  tags: string[];
  existing_roots: string[];
  missing_roots: string[];
  scan_targets: string[];
  qmd_targets: SeedPlanQmdTargets;
  warnings: string[];
}

export interface SeedPlan {
  plan_type: string;
  plan_version: string;
  manifest_version: string;
  context_pack_id: string;
  context_pack_dir: string;
  manifest_path: string;
  qmd_scope_root: string;
  overall_status: string;
  repository_count: number;
  ready_count: number;
  blocked_count: number;
  warning_count: number;
  repositories: SeedPlanRepository[];
  next_steps: string[];
}

export const PLAN_REQUIRED_FIELDS = [
  'context_pack_id',
  'qmd_scope_root',
  'repositories',
] as const;

export type PlanRequiredKey = (typeof PLAN_REQUIRED_FIELDS)[number];

// Type-level drift guards for REQUIRED_FIELDS constants and interface keys.
// Runtime guard behavior is covered by the round-trip tests.

/** Asserts T and U are the exact same type. Produces `never` on mismatch. */
type AssertEqual<T, U> = T extends U ? (U extends T ? true : never) : never;

type _ManifestOptionalKeys =
  | 'repositories'
  | 'focusable_areas'
  | 'repository'
  | 'approved_at'
  | 'display_name'
  | 'default_scope_mode'
  | 'approval_source'
  | 'shared_glossary_terms';

type _AnswersOptionalKeys =
  | 'captured_at'
  | 'repository_count'
  | 'default_scope_mode'
  | 'discovery_mode'
  | 'estate_type'
  | 'primary_working_repo_ids'
  | 'primary_focus_area_ids'
  | 'focusable_areas';

type _PlanOptionalKeys =
  | 'plan_type'
  | 'plan_version'
  | 'manifest_version'
  | 'context_pack_dir'
  | 'manifest_path'
  | 'overall_status'
  | 'repository_count'
  | 'ready_count'
  | 'blocked_count'
  | 'warning_count'
  | 'next_steps';

declare const _manifestDriftGuard: AssertEqual<
  keyof RepoSourcesManifest,
  ManifestRequiredKey | _ManifestOptionalKeys
>;
declare const _answersDriftGuard: AssertEqual<
  keyof BootstrapAnswers,
  AnswersRequiredKey | _AnswersOptionalKeys
>;
declare const _planDriftGuard: AssertEqual<
  keyof SeedPlan,
  PlanRequiredKey | _PlanOptionalKeys
>;

// Mirrors seed-state.json; camelCase translation happens at the desktop-contract boundary.

export interface PackSeedStateRecord {
  state: 'seeded' | 'bootstrap-empty';
  created_at?: string;
  reason?: string;
  details?: Record<string, unknown>;
  last_seed_at?: string;
  last_seed_run_id?: string;
  last_failure_at?: string;
  last_failure_reason?: string;
  last_failure_run_id?: string;
}
