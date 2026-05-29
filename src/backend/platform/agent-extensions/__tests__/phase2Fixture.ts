// Phase 2 confirmation fixture builder (test-only).
//
// Builds deterministic skill/plugin source material under an OS temp directory so
// the catalog → assignment → staging → launch path can be confirmed end-to-end
// against the real production helpers (addAgentExtension/materialize/stage), never
// scratchspace/poc-fixtures, .github/copilot, or operator home directories.
//
// Marker strings are generated at build time (randomUUID) and live only here in test
// setup — they never appear in production files. Tests assert markers stay inside
// runtime/staged content and never leak into display metadata, logs, or receipts.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

// Mirrors the spec dataContract SkillPluginConfirmationFixture. Literal id/displayName/
// description values match the spec; the plugin's catalog display_name is derived from
// the manifest `name` slug (a separate value), which tests assert directly.
export type SkillPluginConfirmationFixture = {
  skill: {
    id: 'phase2-ferret-skill';
    displayName: 'Phase 2 Ferret Skill';
    description: 'Synthetic Phase 2 confirmation skill.';
    marker: string;
    sourceDir: string;
  };
  plugin: {
    id: 'phase2-cobalt-plugin';
    displayName: 'Phase 2 Cobalt Plugin';
    description: 'Synthetic Phase 2 confirmation plugin.';
    marker: string;
    sourceDir: string;
    bundledSkillName: 'phase2-cobalt-echo';
    // The lowercase manifest `name`, which is what inspectPluginMetadata returns as
    // the catalog display_name (display_name !== the human displayName label above).
    manifestName: 'phase2-cobalt-plugin';
  };
  gitSkill: {
    id: 'phase2-git-skill';
    displayName: 'Phase 2 Git Skill';
    description: 'Synthetic git-backed confirmation skill.';
    marker: string;
    bareRepoDir: string;
    commitSha: string;
  };
};

export type Phase2FixtureHandle = {
  fixture: SkillPluginConfirmationFixture;
  cleanup: () => void;
};

function writeSkillMd(dir: string, name: string, description: string, marker: string): void {
  fs.mkdirSync(dir, { recursive: true });
  // Single-line frontmatter values only — the production YAML extractor handles
  // `key: value` lines. The marker lives in the body, not in display metadata.
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\nVerification token: ${marker}\n`,
  );
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString('utf-8')
    .trim();
}

// Build a local bare git repository containing a single skill commit on `main`,
// with no network access. Returns the bare repo path (usable as a git source url)
// and the resolved commit SHA. Skips depth/transport quirks by cloning a working
// repo into a bare mirror.
function buildBareGitSkillRepo(
  baseDir: string,
  name: string,
  description: string,
  marker: string,
): { bareRepoDir: string; commitSha: string } {
  const workDir = path.join(baseDir, 'git-skill-work');
  const bareRepoDir = path.join(baseDir, 'git-skill-bare.git');
  fs.mkdirSync(workDir, { recursive: true });

  git(['init', '-q'], workDir);
  // Portable default-branch rename of the unborn HEAD (works across git versions).
  git(['symbolic-ref', 'HEAD', 'refs/heads/main'], workDir);
  writeSkillMd(workDir, name, description, marker);
  git(['add', 'SKILL.md'], workDir);
  git(
    [
      '-c', 'user.email=phase2@example.com',
      '-c', 'user.name=Phase2 Confirmation',
      '-c', 'commit.gpgsign=false',
      'commit', '-q', '-m', 'phase2 git skill fixture',
    ],
    workDir,
  );
  const commitSha = git(['rev-parse', 'HEAD'], workDir);
  git(['clone', '--bare', '-q', workDir, bareRepoDir], baseDir);

  return { bareRepoDir, commitSha };
}

// Create all three confirmation fixtures under one temp base directory. Caller must
// invoke cleanup() in afterEach. Every path returned is outside the repository.
export function createPhase2Fixtures(): Phase2FixtureHandle {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-fixture-'));

  const skillMarker = `ferret-${randomUUID()}`;
  const pluginMarker = `cobalt-${randomUUID()}`;
  const gitMarker = `gitskill-${randomUUID()}`;

  // Local skill source directory.
  const skillSourceDir = path.join(baseDir, 'ferret-skill-src');
  writeSkillMd(skillSourceDir, 'Phase 2 Ferret Skill', 'Synthetic Phase 2 confirmation skill.', skillMarker);

  // Local plugin source directory with one bundled skill referenced by the manifest.
  const pluginSourceDir = path.join(baseDir, 'cobalt-plugin-src');
  fs.mkdirSync(pluginSourceDir, { recursive: true });
  const bundledSkillRel = path.join('skills', 'phase2-cobalt-echo');
  writeSkillMd(
    path.join(pluginSourceDir, bundledSkillRel),
    'Phase 2 Cobalt Echo',
    'Bundled skill inside the Phase 2 Cobalt plugin.',
    pluginMarker,
  );
  fs.writeFileSync(
    path.join(pluginSourceDir, 'plugin.json'),
    `${JSON.stringify(
      {
        name: 'phase2-cobalt-plugin',
        version: '1.0.0',
        description: 'Synthetic Phase 2 confirmation plugin.',
        skills: ['skills/phase2-cobalt-echo'],
      },
      null,
      2,
    )}\n`,
  );

  // Git-backed skill source (local bare repository, no network).
  const { bareRepoDir, commitSha } = buildBareGitSkillRepo(
    baseDir,
    'Phase 2 Git Skill',
    'Synthetic git-backed confirmation skill.',
    gitMarker,
  );

  const fixture: SkillPluginConfirmationFixture = {
    skill: {
      id: 'phase2-ferret-skill',
      displayName: 'Phase 2 Ferret Skill',
      description: 'Synthetic Phase 2 confirmation skill.',
      marker: skillMarker,
      sourceDir: skillSourceDir,
    },
    plugin: {
      id: 'phase2-cobalt-plugin',
      displayName: 'Phase 2 Cobalt Plugin',
      description: 'Synthetic Phase 2 confirmation plugin.',
      marker: pluginMarker,
      sourceDir: pluginSourceDir,
      bundledSkillName: 'phase2-cobalt-echo',
      manifestName: 'phase2-cobalt-plugin',
    },
    gitSkill: {
      id: 'phase2-git-skill',
      displayName: 'Phase 2 Git Skill',
      description: 'Synthetic git-backed confirmation skill.',
      marker: gitMarker,
      bareRepoDir,
      commitSha,
    },
  };

  return {
    fixture,
    cleanup: () => fs.rmSync(baseDir, { recursive: true, force: true }),
  };
}

// True when a usable `git` binary is present, so git-source confirmation can run.
// Used to skip (never silently pass) the git case in an environment without git.
export function isGitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
