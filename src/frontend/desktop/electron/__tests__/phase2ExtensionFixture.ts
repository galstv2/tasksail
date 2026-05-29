// Phase 2 confirmation fixture for the Lily/planner launch-extension path (test-only).
//
// resolveLilyPlannerLaunchExtensions runs the REAL backend createAgentExtensionStage, which
// reads config/agent-extensions.default.json, .platform-state/{skills,plugins}/<id>/ runtime
// copies, and .platform-state/agent-launch-extensions.json. This fixture writes that on-disk
// layout into a temp repo with production-faithful cached values, so planner confirmation tests
// exercise production staging end-to-end without scratchspace/poc-fixtures or operator home.
//
// Marker strings are generated at build time and live only here in test setup; tests assert
// markers stay inside staged content and never reach availability notes, history, or logs.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

type AgentId =
  | 'planning-agent'
  | 'product-manager'
  | 'software-engineer'
  | 'software-engineer-verify'
  | 'qa';

const ALL_AGENTS: AgentId[] = [
  'planning-agent',
  'product-manager',
  'software-engineer',
  'software-engineer-verify',
  'qa',
];

export type Phase2ElectronFixture = {
  repo: string;
  skill: { id: string; displayName: string; description: string; marker: string };
  plugin: { id: string; displayName: string; description: string; marker: string; bundledSkillName: string };
  // Assign extension IDs to one agent (others empty). Call before resolving a launch.
  assignTo: (agentId: AgentId, extensionIds: string[]) => void;
  cleanup: () => void;
};

function writeSkillRuntime(repo: string, id: string, name: string, description: string, marker: string): void {
  const dir = path.join(repo, '.platform-state', 'skills', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nVerification token: ${marker}\n`,
  );
}

function writePluginRuntime(
  repo: string,
  id: string,
  manifestName: string,
  description: string,
  marker: string,
  bundledSkillName: string,
): void {
  const dir = path.join(repo, '.platform-state', 'plugins', id);
  const bundledRel = path.join('skills', bundledSkillName);
  fs.mkdirSync(path.join(dir, bundledRel), { recursive: true });
  fs.writeFileSync(
    path.join(dir, bundledRel, 'SKILL.md'),
    `---\nname: ${bundledSkillName}\ndescription: Bundled skill.\n---\n\nVerification token: ${marker}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    `${JSON.stringify({ name: manifestName, version: '1.0.0', description, skills: [`skills/${bundledSkillName}`] }, null, 2)}\n`,
  );
}

// Create a temp repo with one enabled skill and one enabled plugin already "imported"
// (manifest entry + runtime copy), using production-faithful cached values: a plugin's
// cached display_name is its lowercase manifest name, matching real addAgentExtension.
export function createPhase2ElectronFixture(): Phase2ElectronFixture {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-electron-'));
  fs.mkdirSync(path.join(repo, '.platform-state'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });

  const skillMarker = `ferret-${randomUUID()}`;
  const pluginMarker = `cobalt-${randomUUID()}`;

  const skill = {
    id: 'phase2-ferret-skill',
    displayName: 'Phase 2 Ferret Skill',
    description: 'Synthetic Phase 2 confirmation skill.',
    marker: skillMarker,
  };
  const plugin = {
    id: 'phase2-cobalt-plugin',
    // Plugin cached display_name is the lowercase manifest name (production behavior).
    displayName: 'phase2-cobalt-plugin',
    description: 'Synthetic Phase 2 confirmation plugin.',
    marker: pluginMarker,
    bundledSkillName: 'phase2-cobalt-echo',
  };

  writeSkillRuntime(repo, skill.id, skill.displayName, skill.description, skill.marker);
  writePluginRuntime(repo, plugin.id, plugin.displayName, plugin.description, plugin.marker, plugin.bundledSkillName);

  fs.writeFileSync(
    path.join(repo, 'config', 'agent-extensions.default.json'),
    JSON.stringify(
      {
        schema_version: 1,
        extensions: [
          {
            id: skill.id,
            kind: 'skill',
            provider_id: 'copilot',
            display_name: skill.displayName,
            description: skill.description,
            enabled: true,
            source: { type: 'local', path: '/dev/null/ferret' },
          },
          {
            id: plugin.id,
            kind: 'plugin',
            provider_id: 'copilot',
            display_name: plugin.displayName,
            description: plugin.description,
            enabled: true,
            source: { type: 'local', path: '/dev/null/cobalt' },
          },
        ],
      },
      null,
      2,
    ),
  );

  const assignTo = (agentId: AgentId, extensionIds: string[]): void => {
    fs.writeFileSync(
      path.join(repo, '.platform-state', 'agent-launch-extensions.json'),
      JSON.stringify(
        {
          schema_version: 1,
          assignments: ALL_AGENTS.map((id) => ({
            agent_id: id,
            extension_ids: id === agentId ? extensionIds : [],
          })),
        },
        null,
        2,
      ),
    );
  };

  return {
    repo,
    skill,
    plugin,
    assignTo,
    cleanup: () => fs.rmSync(repo, { recursive: true, force: true }),
  };
}
