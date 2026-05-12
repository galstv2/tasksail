/**
 * Bootstrap contract validation rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_bootstrap.py
 */

import path from 'node:path';
import { readTextFile, safeJsonParse } from '../../core/index.js';
import { normalizeManifestLocalPaths } from '../../context-pack/localPaths.js';
import { ALLOWED_SYSTEM_LAYERS } from '../models.js';
import type { PolicyValidator } from '../validator.js';

export async function evaluateBootstrapRules(validator: PolicyValidator): Promise<void> {
  validator.recordRule('bootstrap.answers-json-readable');
  validator.recordRule('bootstrap.manifest-json-readable');
  validator.recordRule('bootstrap.answers-contract');
  validator.recordRule('bootstrap.manifest-contract');
  validator.recordRule('bootstrap.context-pack-id-match');
  validator.recordRule('bootstrap.repo-contract-match');

  if (validator.mode === 'runtime') {
    return;
  }

  if (validator.contextPackDir === null) {
    return;
  }

  const answersPath = path.join(
    validator.contextPackDir,
    'qmd',
    'bootstrap',
    'bootstrap-answers.json',
  );
  const manifestPath = path.join(validator.contextPackDir, 'qmd', 'repo-sources.json');
  const answersText = await readTextFile(answersPath);
  const shouldValidate = validator.mode === 'activation-bootstrap' || answersText !== undefined;
  if (!shouldValidate) {
    return;
  }

  let answersPayload: Record<string, unknown> | null = null;
  let manifestPayload: Record<string, unknown> | null = null;

  if (answersText === undefined) {
    validator.addViolation({
      rule_id: 'bootstrap.answers-contract',
      artifact: answersPath,
      message:
        'Bootstrap validation was requested, but qmd/bootstrap/bootstrap-answers.json is missing.',
      remediation:
        'Capture or restore the normalized bootstrap questionnaire answers before treating the context pack as bootstrap-valid.',
    });
  } else {
    try {
      const loaded = safeJsonParse<unknown>(answersText, answersPath);
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
        throw new Error('bootstrap answers must be a JSON object');
      }
      answersPayload = loaded as Record<string, unknown>;
    } catch (exc) {
      validator.addViolation({
        rule_id: 'bootstrap.answers-json-readable',
        artifact: answersPath,
        message: `Bootstrap answers could not be parsed as JSON: ${exc instanceof Error ? exc.message : String(exc)}`,
        remediation:
          'Rewrite qmd/bootstrap/bootstrap-answers.json as a valid JSON object that matches the bootstrap questionnaire contract.',
      });
    }
  }

  const manifestText = await readTextFile(manifestPath);
  if (manifestText === undefined) {
    validator.addViolation({
      rule_id: 'bootstrap.manifest-contract',
      artifact: manifestPath,
      message: 'Bootstrap validation requires qmd/repo-sources.json to exist.',
      remediation:
        'Generate or restore qmd/repo-sources.json before treating the context pack as bootstrap-valid.',
    });
  } else {
    try {
      const loaded = safeJsonParse<unknown>(manifestText, manifestPath);
      if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
        throw new Error('repo manifest must be a JSON object');
      }
      manifestPayload = loaded as Record<string, unknown>;
    } catch (exc) {
      validator.addViolation({
        rule_id: 'bootstrap.manifest-json-readable',
        artifact: manifestPath,
        message: `Bootstrap manifest could not be parsed as JSON: ${exc instanceof Error ? exc.message : String(exc)}`,
        remediation:
          'Rewrite qmd/repo-sources.json as a valid JSON object that matches the repo manifest contract.',
      });
    }
  }

  if (answersPayload !== null) {
    validateAnswersContract(validator, answersPath, answersPayload);
  }
  if (manifestPayload !== null) {
    validateManifestContract(validator, manifestPath, manifestPayload);
  }
  if (answersPayload !== null && manifestPayload !== null) {
    compareBootstrapContracts(validator, manifestPath, answersPayload, manifestPayload);
  }
}

function validateAnswersContract(
  validator: PolicyValidator,
  answersPath: string,
  payload: Record<string, unknown>,
): void {
  const contextPackId = String(payload.context_pack_id ?? '').trim();
  const repositories = payload.repositories;

  if (!contextPackId) {
    validator.addViolation({
      rule_id: 'bootstrap.answers-contract',
      artifact: answersPath,
      message: 'Bootstrap answers must include a non-empty context_pack_id.',
      remediation:
        'Record a context_pack_id in qmd/bootstrap/bootstrap-answers.json before validating bootstrap legality.',
    });
  }

  if (!Array.isArray(repositories) || repositories.length === 0) {
    validator.addViolation({
      rule_id: 'bootstrap.answers-contract',
      artifact: answersPath,
      message: 'Bootstrap answers must include at least one repository entry.',
      remediation:
        'Add one or more repository entries to qmd/bootstrap/bootstrap-answers.json before validating bootstrap legality.',
    });
    return;
  }

  for (const [index, rawRepo] of (repositories as unknown[]).entries()) {
    const i = index + 1;
    if (!rawRepo || typeof rawRepo !== 'object' || Array.isArray(rawRepo)) {
      validator.addViolation({
        rule_id: 'bootstrap.answers-contract',
        artifact: answersPath,
        message: `Bootstrap answers repository #${i} must be a JSON object.`,
        remediation:
          'Rewrite malformed repository entries in qmd/bootstrap/bootstrap-answers.json as JSON objects.',
      });
      continue;
    }

    const repo = rawRepo as Record<string, unknown>;
    const repoId = String(repo.repo_id ?? '').trim();
    const repoName = String(repo.repo_name ?? '').trim();
    const repoRoot = String(repo.repo_root ?? '').trim();
    const systemLayer = String(repo.system_layer ?? '').trim();

    if (!repoId || !repoName || !repoRoot || !systemLayer) {
      validator.addViolation({
        rule_id: 'bootstrap.answers-contract',
        artifact: answersPath,
        message: `Bootstrap answers repository #${i} must include repo_id, repo_name, repo_root, and system_layer.`,
        remediation:
          'Populate the minimum repository contract for every bootstrap questionnaire entry.',
      });
      continue;
    }

    if (!ALLOWED_SYSTEM_LAYERS.has(systemLayer)) {
      validator.addViolation({
        rule_id: 'bootstrap.answers-contract',
        artifact: answersPath,
        message: `Bootstrap answers repository '${repoId}' uses unsupported system_layer '${systemLayer}'.`,
        remediation:
          'Use one of backend, frontend, infrastructure, database, documents, or shared for bootstrap repository system_layer.',
      });
    }
  }
}

function validateManifestContract(
  validator: PolicyValidator,
  manifestPath: string,
  payload: Record<string, unknown>,
): void {
  const contextPackId = String(payload.context_pack_id ?? '').trim();
  const qmdScopeRoot = String(payload.qmd_scope_root ?? '').trim();
  const repositories = payload.repositories;

  if (!contextPackId) {
    validator.addViolation({
      rule_id: 'bootstrap.manifest-contract',
      artifact: manifestPath,
      message: 'Repo manifest must include a non-empty context_pack_id.',
      remediation:
        'Populate context_pack_id in qmd/repo-sources.json before validating bootstrap legality.',
    });
  }

  const expectedScopeRoot = contextPackId ? `qmd/context-packs/${contextPackId}` : '';
  if (contextPackId && qmdScopeRoot !== expectedScopeRoot) {
    validator.addViolation({
      rule_id: 'bootstrap.manifest-contract',
      artifact: manifestPath,
      message: `Repo manifest qmd_scope_root should be '${expectedScopeRoot}', found '${qmdScopeRoot || '<blank>'}'.`,
      remediation:
        'Set qmd_scope_root to qmd/context-packs/<context_pack_id> in qmd/repo-sources.json.',
    });
  }

  if (!Array.isArray(repositories) || repositories.length === 0) {
    validator.addViolation({
      rule_id: 'bootstrap.manifest-contract',
      artifact: manifestPath,
      message: 'Repo manifest must include at least one repository entry.',
      remediation:
        'Add one or more repositories to qmd/repo-sources.json before validating bootstrap legality.',
    });
    return;
  }

  for (const [index, rawRepo] of (repositories as unknown[]).entries()) {
    const i = index + 1;
    if (!rawRepo || typeof rawRepo !== 'object' || Array.isArray(rawRepo)) {
      validator.addViolation({
        rule_id: 'bootstrap.manifest-contract',
        artifact: manifestPath,
        message: `Repo manifest repository #${i} must be a JSON object.`,
        remediation:
          'Rewrite malformed repository entries in qmd/repo-sources.json as JSON objects.',
      });
      continue;
    }

    const repo = rawRepo as Record<string, unknown>;
    const repoId = String(repo.repo_id ?? '').trim();
    const repoName = String(repo.repo_name ?? '').trim();
    const systemLayer = String(repo.system_layer ?? '').trim();
    const validLocalPaths = normalizeManifestLocalPaths(repo.local_paths);

    if (!repoId || !repoName || !systemLayer || validLocalPaths.length === 0) {
      validator.addViolation({
        rule_id: 'bootstrap.manifest-contract',
        artifact: manifestPath,
        message: `Repo manifest repository #${i} must include repo_id, repo_name, non-empty local_paths, and system_layer.`,
        remediation:
          'Populate the minimum repository contract for every manifest repository entry.',
      });
      continue;
    }

    if (!ALLOWED_SYSTEM_LAYERS.has(systemLayer)) {
      validator.addViolation({
        rule_id: 'bootstrap.manifest-contract',
        artifact: manifestPath,
        message: `Repo manifest repository '${repoId}' uses unsupported system_layer '${systemLayer}'.`,
        remediation:
          'Use one of backend, frontend, infrastructure, database, documents, or shared for manifest repository system_layer.',
      });
    }
  }
}

function compareBootstrapContracts(
  validator: PolicyValidator,
  manifestPath: string,
  answersPayload: Record<string, unknown>,
  manifestPayload: Record<string, unknown>,
): void {
  const answersId = String(answersPayload.context_pack_id ?? '').trim();
  const manifestId = String(manifestPayload.context_pack_id ?? '').trim();

  if (answersId && manifestId && answersId !== manifestId) {
    validator.addViolation({
      rule_id: 'bootstrap.context-pack-id-match',
      artifact: manifestPath,
      message: `Bootstrap answers and repo manifest disagree on context_pack_id: '${answersId}' vs '${manifestId}'.`,
      remediation:
        'Regenerate or edit qmd/repo-sources.json so it matches the operator-approved bootstrap answers contract.',
    });
  }

  const answersRepositories = answersPayload.repositories;
  const manifestRepositories = manifestPayload.repositories;
  if (!Array.isArray(answersRepositories) || !Array.isArray(manifestRepositories)) {
    return;
  }

  const answersByRepoId = new Map<string, Record<string, unknown>>();
  for (const rawRepo of answersRepositories) {
    if (!rawRepo || typeof rawRepo !== 'object' || Array.isArray(rawRepo)) {
      continue;
    }
    const repo = rawRepo as Record<string, unknown>;
    const repoId = String(repo.repo_id ?? '').trim();
    if (repoId) {
      answersByRepoId.set(repoId, repo);
    }
  }

  const manifestByRepoId = new Map<string, Record<string, unknown>>();
  for (const rawRepo of manifestRepositories) {
    if (!rawRepo || typeof rawRepo !== 'object' || Array.isArray(rawRepo)) {
      continue;
    }
    const repo = rawRepo as Record<string, unknown>;
    const repoId = String(repo.repo_id ?? '').trim();
    if (repoId) {
      manifestByRepoId.set(repoId, repo);
    }
  }

  const answerRepoIds = [...answersByRepoId.keys()].sort();
  const manifestRepoIds = [...manifestByRepoId.keys()].sort();
  if (
    answerRepoIds.length !== manifestRepoIds.length
    || answerRepoIds.some((repoId, index) => repoId !== manifestRepoIds[index])
  ) {
    validator.addViolation({
      rule_id: 'bootstrap.repo-contract-match',
      artifact: manifestPath,
      message: `Bootstrap answers and repo manifest disagree on repository inventory. answers=${JSON.stringify(answerRepoIds)} manifest=${JSON.stringify(manifestRepoIds)}`,
      remediation:
        'Keep qmd/repo-sources.json in lockstep with qmd/bootstrap/bootstrap-answers.json for the initial repository inventory.',
    });
    return;
  }

  for (const repoId of answerRepoIds) {
    const answersRepo = answersByRepoId.get(repoId)!;
    const manifestRepo = manifestByRepoId.get(repoId)!;
    const answersRepoName = String(answersRepo.repo_name ?? '').trim();
    const manifestRepoName = String(manifestRepo.repo_name ?? '').trim();
    const answersRepoRoot = String(answersRepo.repo_root ?? '').trim();
    const manifestLocalPaths = normalizeManifestLocalPaths(manifestRepo.local_paths);
    const answersSystemLayer = String(answersRepo.system_layer ?? '').trim();
    const manifestSystemLayer = String(manifestRepo.system_layer ?? '').trim();

    if (answersRepoName && manifestRepoName && answersRepoName !== manifestRepoName) {
      validator.addViolation({
        rule_id: 'bootstrap.repo-contract-match',
        artifact: manifestPath,
        message: `Repository '${repoId}' changed repo_name between bootstrap answers ('${answersRepoName}') and repo manifest ('${manifestRepoName}').`,
        remediation:
          'Keep repo_name stable between qmd/bootstrap/bootstrap-answers.json and qmd/repo-sources.json.',
      });
    }

    if (answersRepoRoot && manifestLocalPaths.length > 0 && !manifestLocalPaths.includes(answersRepoRoot)) {
      validator.addViolation({
        rule_id: 'bootstrap.repo-contract-match',
        artifact: manifestPath,
        message: `Repository '${repoId}' changed local path between bootstrap answers ('${answersRepoRoot}') and repo manifest (${JSON.stringify(manifestLocalPaths)}).`,
        remediation:
          'Keep local_paths aligned with the bootstrap questionnaire repo_root values for bootstrap-created context packs.',
      });
    }

    if (answersSystemLayer && manifestSystemLayer && answersSystemLayer !== manifestSystemLayer) {
      validator.addViolation({
        rule_id: 'bootstrap.repo-contract-match',
        artifact: manifestPath,
        message: `Repository '${repoId}' changed system_layer between bootstrap answers ('${answersSystemLayer}') and repo manifest ('${manifestSystemLayer}').`,
        remediation:
          'Keep system_layer aligned between qmd/bootstrap/bootstrap-answers.json and qmd/repo-sources.json.',
      });
    }
  }
}
