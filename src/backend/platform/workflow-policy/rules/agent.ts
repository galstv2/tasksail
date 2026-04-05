/**
 * Named-agent registry, instruction heading, and profile rules.
 *
 * Ported from Python: src/backend/scripts/python/lib/policy/rules_agent.py
 */

import path from 'node:path';
import { readTextFile, safeJsonParse } from '../../core/index.js';
import {
  canonicalAgentLabel,
  expectedInstructionHeading,
  parseChatagentProfile,
} from '../agents.js';
import {
  AGENT_MODEL_CATALOG_RELATIVE_PATH,
  AGENT_MODEL_PATTERN,
  AGENT_REGISTRY_RELATIVE_PATH,
} from '../models.js';
import type { PolicyValidator } from '../validator.js';

interface ModelCatalogEntry {
  model_id?: string;
}

interface ModelCatalogPayload {
  models?: unknown[];
}

async function loadCatalogModelIds(validator: PolicyValidator): Promise<Set<string> | null> {
  const catalogPath = path.join(validator.rootDir, AGENT_MODEL_CATALOG_RELATIVE_PATH);
  const raw = await readTextFile(catalogPath);
  if (raw === undefined) return null;
  try {
    const payload = safeJsonParse<ModelCatalogPayload>(raw, AGENT_MODEL_CATALOG_RELATIVE_PATH);
    if (!payload || !Array.isArray(payload.models)) return null;
    const ids = new Set<string>();
    for (const entry of payload.models as ModelCatalogEntry[]) {
      if (entry && typeof entry.model_id === 'string' && entry.model_id.trim()) {
        ids.add(entry.model_id.trim());
      }
    }
    return ids;
  } catch {
    return null;
  }
}

export async function evaluateNamedAgentRules(
  validator: PolicyValidator,
): Promise<void> {
  validator.recordRule('artifact.named-agent-registry');
  validator.recordRule('artifact.named-agent-instruction-headings');
  validator.recordRule('artifact.named-agent-profiles');
  validator.recordRule('artifact.named-agent-model-catalog-gate');

  if (validator.namedAgentRegistryErrors.length > 0) {
    for (const error of validator.namedAgentRegistryErrors) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-registry',
        artifact: AGENT_REGISTRY_RELATIVE_PATH,
        message: error,
        remediation:
          'Fix .github/agents/registry.json so the workflow validator can derive the canonical repository agent roster.',
      });
    }
    return;
  }

  for (const [agentKey, agent] of Object.entries(validator.namedAgentTeam)) {
    const agentLabel = canonicalAgentLabel(validator.namedAgentTeam, agentKey);
    const relativePath = agent.instructionPath;
    const instructionPath = path.join(validator.rootDir, relativePath);
    const instructionText = await readTextFile(instructionPath);

    if (instructionText === undefined) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-instruction-headings',
        artifact: relativePath,
        message: `Named-agent validation requires the instruction file for ${agentLabel} to exist.`,
        remediation: 'Restore the named-agent instruction files under .github/copilot/instructions/.',
      });
      continue;
    }

    const firstNonEmptyLine =
      instructionText
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? '';

    const expected = expectedInstructionHeading(validator.namedAgentTeam, agentKey);
    if (firstNonEmptyLine !== expected) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-instruction-headings',
        artifact: relativePath,
        message: `${relativePath} must begin with '${expected}' so the named workflow roster stays canonical.`,
        remediation: `Update ${relativePath} to use the heading '${expected}'.`,
      });
    }

    const profileRelativePath = agent.agentProfilePath;
    const profilePath = path.join(validator.rootDir, profileRelativePath);
    const profileText = await readTextFile(profilePath);

    if (profileText === undefined) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `Named-agent validation requires the custom agent profile for ${agentLabel} to exist under .github/agents/.`,
        remediation:
          'Restore the custom agent profiles under .github/agents/ so the workflow can route through repository-scoped agent definitions.',
      });
      continue;
    }

    const { frontmatter, body, errors: parseErrors } = parseChatagentProfile(profileText);
    if (parseErrors.length > 0) {
      for (const error of parseErrors) {
        validator.addViolation({
          rule_id: 'artifact.named-agent-profiles',
          artifact: profileRelativePath,
          message: `${profileRelativePath} is not a valid custom agent profile: ${error}`,
          remediation:
            'Use the GitHub custom agent markdown format with YAML frontmatter and a non-empty body. A ```chatagent fence is optional.',
        });
      }
      continue;
    }

    const profileName = (frontmatter.name ?? '').trim();
    if (profileName !== agentKey) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} must declare name: ${agentKey} so the repo agent ID matches the workflow roster.`,
        remediation: `Update ${profileRelativePath} to set name: ${agentKey}.`,
      });
    }

    if (!(frontmatter.description ?? '').trim()) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} must include a non-empty description in frontmatter.`,
        remediation: `Add a concise description: field to ${profileRelativePath}.`,
      });
    }

    const model = (frontmatter.model ?? '').trim();
    if (model && !AGENT_MODEL_PATTERN.test(model)) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} has an invalid model value '${model}'.`,
        remediation:
          'Use a valid GitHub Copilot model identifier such as gpt-4.1 or gpt-5.4.',
      });
    }

    if (!body) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} must include workflow guidance in the body.`,
        remediation: `Restore the agent instructions body in ${profileRelativePath}.`,
      });
      continue;
    }

    const expectedIdentity = (agent.expectedAgentIdentity ?? '').trim();
    if (expectedIdentity && !body.includes(expectedIdentity)) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} must identify ${agentLabel} in the body.`,
        remediation: `Restore the role identity line '${expectedIdentity}' in ${profileRelativePath}.`,
      });
    }

    const expectedInstructionPhrase = `Follow the repository workflow and the ${agent.role} instructions.`;
    if (!body.includes(expectedInstructionPhrase)) {
      validator.addViolation({
        rule_id: 'artifact.named-agent-profiles',
        artifact: profileRelativePath,
        message: `${profileRelativePath} must point back to the ${agent.role} instruction file so the agent and repo workflow stay aligned.`,
        remediation: `Include '${expectedInstructionPhrase}' in ${profileRelativePath}.`,
      });
    }
  }

  const catalogModelIds = await loadCatalogModelIds(validator);
  if (catalogModelIds !== null) {
    for (const [agentKey, agent] of Object.entries(validator.namedAgentTeam)) {
      const model = agent.requiredModel;
      if (model && !catalogModelIds.has(model)) {
        const agentLabel = canonicalAgentLabel(validator.namedAgentTeam, agentKey);
        validator.addViolation({
          rule_id: 'artifact.named-agent-model-catalog-gate',
          artifact: AGENT_REGISTRY_RELATIVE_PATH,
          message: `${agentLabel} requires model "${model}" which is not in ${AGENT_MODEL_CATALOG_RELATIVE_PATH}.`,
          remediation: `Add "${model}" to ${AGENT_MODEL_CATALOG_RELATIVE_PATH} or change the agent's required_model to one that exists in the catalog.`,
        });
      }
    }
  }
}
