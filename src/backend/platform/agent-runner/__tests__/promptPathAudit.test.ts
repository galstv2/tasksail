import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildAgentRuntimePathManifest } from '../agentRuntimePathManifest.js';
import { getActiveProvider } from '../../cli-provider/index.js';

const REPO_ROOT = join(import.meta.dirname, '../../../../..');
const provider = getActiveProvider(REPO_ROOT);

function repoRelative(filePath: string): string {
  return relative(REPO_ROOT, filePath).split(sep).join('/');
}

function listMarkdownFiles(relDir: string): string[] {
  const root = join(REPO_ROOT, relDir);
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(repoRelative(fullPath));
      }
    }
  };
  walk(root);
  return files.sort();
}

const MIGRATED_FILES = [
  ...listMarkdownFiles('.github/copilot/instructions'),
  ...listMarkdownFiles('.github/copilot/prompts'),
];

describe('promptPathAudit — §1.7 migration', () => {
  // Per-file: no bare literal paths remain; env-var references expand correctly
  for (const relPath of MIGRATED_FILES) {
    it(`${relPath}: no bare literal paths`, () => {
      const raw = readFileSync(join(REPO_ROOT, relPath), 'utf-8');

      expect(raw, 'raw must not contain AgentWorkSpace/handoffs').not.toContain(
        'AgentWorkSpace/handoffs',
      );
      expect(raw, 'raw must not contain AgentWorkSpace/ImplementationSteps').not.toContain(
        'AgentWorkSpace/ImplementationSteps',
      );
    });
  }

  it('all runtime env symbols referenced by instructions and prompts are covered by the Runtime Path Manifest', () => {
    const manifestEnv = {
      ACTIVE_CONTEXT_PACK_DIR: 'value',
      ACTIVE_CONTEXT_PACK_HOST_DIR: 'value',
      TASKSAIL_TASK_ID: 'value',
      TASKSAIL_TASK_BRANCHES: 'value',
      TASKSAIL_TASK_BRANCHES_FILE: 'value',
      TASKSAIL_TASK_WORKTREES: 'value',
      TASKSAIL_TASK_WORKTREES_FILE: 'value',
      TASKSAIL_REALIGNMENT_STAGING_PATH: 'value',
      RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: 'value',
      RUN_ROLE_AGENT_AUTONOMY_ALLOWED_DIRS_JSON: 'value',
      RUN_ROLE_AGENT_AUTONOMY_WORKING_DIR: 'value',
      RUN_ROLE_AGENT_AUTONOMY_BOUNDARY_STATUS: 'value',
      CONTEXT_PACK_CONVENTIONS_STATUS: 'value',
      CONTEXT_PACK_CONVENTIONS_CONTEXT_FILE: 'value',
      CONTEXT_PACK_CORRECTIONS_STATUS: 'value',
      CONTEXT_PACK_CORRECTIONS_CONTEXT_FILE: 'value',
      EXTERNAL_MCP_CONTEXT_STATUS: 'value',
      EXTERNAL_MCP_CONTEXT_FILE: 'value',
      REPO_CONTEXT_MCP_URL: 'value',
      REPO_CONTEXT_MCP_PORT: 'value',
      COPILOT_PLATFORM_REPO_ROOT: 'value',
      COPILOT_HANDOFFS_DIR: 'value',
      COPILOT_IMPL_STEPS_DIR: 'value',
      COPILOT_TARGET_REPOS_JSON: 'value',
      COPILOT_PRIMARY_FOCUS_PATH: 'value',
      COPILOT_PRIMARY_FOCUS_TARGET_KIND: 'value',
      COPILOT_PRIMARY_FOCUS_TARGETS_JSON: 'value',
      COPILOT_WRITABLE_ROOTS_JSON: 'value',
      COPILOT_READONLY_CONTEXT_ROOTS_JSON: 'value',
      COPILOT_TEST_TARGET_PATH: 'value',
      COPILOT_TEST_TARGET_KIND: 'value',
    };
    const manifestNames = new Set(buildAgentRuntimePathManifest({
      agentId: 'ron',
      agentCwd: '/repo',
      env: manifestEnv,
      providerEnvVars: provider.runtimeManifestEnvVars(),
    }).entries.map((entry) => entry.name));

    const corpus = MIGRATED_FILES.map((file) => readFileSync(join(REPO_ROOT, file), 'utf-8')).join('\n');
    const referenced = [...new Set(corpus.match(/\b(?:COPILOT_[A-Z0-9_]+|TASKSAIL_(?:TASK|REALIGNMENT)_[A-Z0-9_]+|RUN_ROLE_AGENT_AUTONOMY_[A-Z0-9_]+|EXTERNAL_MCP_[A-Z0-9_]+|CONTEXT_PACK_[A-Z0-9_]+)\b/g) ?? [])].sort();
    expect(referenced.length).toBeGreaterThan(0);

    const missing = referenced.filter((name) => !manifestNames.has(name));
    expect(missing).toEqual([]);
  });
});

/**
 * Phase 6 — Codebase-wide regression guard.
 *
 * Asserts that no tracked file in the repo contains bare legacy singleton
 * paths (`AgentWorkSpace/handoffs` or `AgentWorkSpace/ImplementationSteps`)
 * outside of explicitly allowed locations.
 */
describe('codebase-wide legacy path regression guard', () => {
  const FORBIDDEN_LITERALS = [
    'AgentWorkSpace/handoffs',
    'AgentWorkSpace/ImplementationSteps',
  ] as const;

  // Files that are allowed to mention the forbidden literals:
  // - this test file itself (it defines the literals)
  const ALLOW_LIST_PATTERNS = [
    'src/backend/platform/agent-runner/__tests__/promptPathAudit.test.ts',
  ];

  function isAllowListed(filePath: string): boolean {
    return ALLOW_LIST_PATTERNS.some((p) => filePath.includes(p));
  }

  it('no tracked file references legacy AgentWorkSpace/handoffs or AgentWorkSpace/ImplementationSteps', () => {
    // Single git grep invocation searching both forbidden literals at once.
    let output: string;
    try {
      output = execFileSync(
        'git',
        [
          'grep', '-n', '--fixed-strings',
          '-e', FORBIDDEN_LITERALS[0],
          '-e', FORBIDDEN_LITERALS[1],
          '--',
        ],
        { cwd: REPO_ROOT, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      );
    } catch {
      // git grep exits 1 when there are no matches — that's the success case.
      return;
    }

    const violations: string[] = [];
    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const filePart = line.split(':')[0];
      if (filePart && isAllowListed(filePart)) continue;

      // Skip negative assertions and test-description strings.
      if (
        line.includes('.not.toContain') ||
        line.includes('assertNotIn') ||
        line.includes('NEGATIVE_ASSERTIONS') ||
        line.includes('_NEGATIVE_ASSERTIONS') ||
        /\bit\(\s*['"`]/.test(line) ||
        /\bdescribe\(\s*['"`]/.test(line)
      ) {
        continue;
      }

      violations.push(line);
    }

    expect(
      violations,
      `Found ${violations.length} file(s) still referencing legacy singleton paths:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });
});
