import { describe, expect, it } from 'vitest';
import {
  buildAgentRuntimePathManifest,
  prependRuntimePathManifestToPrompt,
  renderAgentRuntimePathManifestForPrompt,
  type AgentRuntimePathManifestValueKind,
} from '../agentRuntimePathManifest.js';
import { copilotProvider } from '../../cli-provider/providers/copilot/index.js';
import { SPEC_REQUIRED_SECTION_SPECS } from '../../workflow-policy/models.js';

// Derives the bullet prefix `- NAME (kind): value --` from the production renderer.
// Centralizes the format so a single template change ripples through one place
// instead of breaking N toContain assertions silently at the wrong location.
function bulletPrefix(name: string, kind: AgentRuntimePathManifestValueKind, value: string): string {
  const rendered = renderAgentRuntimePathManifestForPrompt({
    agentId: 'fixture',
    agentCwd: '/fixture',
    entries: [{ name, value, kind, description: 'fixture-description' }],
  });
  const bullet = rendered.split('\n').find((line) => line.startsWith(`- ${name} `));
  if (!bullet) throw new Error(`renderer did not emit a bullet for ${name}`);
  return bullet.replace(/ fixture-description$/, '').trimEnd();
}

function renderedSection(rendered: string, heading: string): string {
  const start = rendered.indexOf(heading);
  if (start === -1) return '';
  const next = rendered.indexOf('\n## ', start + heading.length);
  return rendered.slice(start, next === -1 ? undefined : next);
}

describe('agentRuntimePathManifest', () => {
  it('renders deterministic allowlisted entries and omits arbitrary env keys', () => {
    const env = {
      TASKSAIL_TASK_ID: 'task-1',
      TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform"}]',
      TASKSAIL_TASK_BRANCHES_FILE: '/runtime/task-1/task-branches.json',
      TASKSAIL_TASK_WORKTREES: '[{"repoId":"platform"}]',
      RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON: '{"boundary":"repo-root"}',
      EXTERNAL_MCP_CONTEXT_FILE: '/runtime/mcp/context.json',
      COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-1/handoffs',
      COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps',
      COPILOT_WRITABLE_ROOTS_JSON: '[{"path":"/repo/src","kind":"directory"}]',
      COPILOT_PRIMARY_FOCUS_PATH: 'src/index.ts',
      SECRET_TOKEN: 'do-not-render',
    };
    const args = {
      agentId: 'ron',
      launchPhase: 'Artifact Cleanup',
      agentCwd: '/repo',
      env,
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
    };

    const first = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest(args));
    const second = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest(args));

    expect(first).toBe(second);
    expect(first).toContain('## Runtime Path Manifest');
    expect(first).toContain('Agent launch CWD: /repo');
    expect(first).toContain('Do not write $NAME or $NAME/... as a literal filesystem path; resolve the variable through this manifest first.');
    expect(first).toContain('If a value is JSON, parse it before using paths or branch metadata.');
    expect(first).toContain('If a _FILE value is present, read that file for the payload instead of guessing the inline value.');
    expect(first).toContain('Omitted variables are unavailable for this launch.');
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_ID', 'scalar', 'task-1'));
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_BRANCHES', 'json', '[{"repoId":"platform"}]'));
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_BRANCHES_FILE', 'file', '/runtime/task-1/task-branches.json'));
    expect(first).toContain(bulletPrefix('TASKSAIL_TASK_WORKTREES', 'json', '[{"repoId":"platform"}]'));
    expect(first).toContain('Inline JSON branch metadata for branch-owned task repo bindings.');
    expect(first).toContain('Inline JSON worktree metadata for all task-visible worktrees.');
    expect(first).toContain(bulletPrefix('RUN_ROLE_AGENT_AUTONOMY_PROFILE_JSON', 'json', '{"boundary":"repo-root"}'));
    expect(first).toContain(bulletPrefix('EXTERNAL_MCP_CONTEXT_FILE', 'file', '/runtime/mcp/context.json'));
    expect(first).toContain(bulletPrefix('COPILOT_HANDOFFS_DIR', 'path', '/repo/AgentWorkSpace/tasks/task-1/handoffs'));
    expect(first).toContain(bulletPrefix('COPILOT_IMPL_STEPS_DIR', 'path', '/repo/AgentWorkSpace/tasks/task-1/ImplementationSteps'));
    expect(first).toContain(bulletPrefix('COPILOT_WRITABLE_ROOTS_JSON', 'json', '[{"path":"/repo/src","kind":"directory"}]'));
    expect(first).toContain(bulletPrefix('COPILOT_PRIMARY_FOCUS_PATH', 'path', 'src/index.ts'));
    expect(first).not.toContain('SECRET_TOKEN');
    expect(first).not.toContain('do-not-render');
    expect(first.indexOf('TASKSAIL_TASK_ID')).toBeLessThan(first.indexOf('COPILOT_HANDOFFS_DIR'));
  });

  it('prepends the manifest without mutating prompt text', () => {
    const manifest = buildAgentRuntimePathManifest({
      agentId: 'alice',
      agentCwd: '/repo',
      env: { TASKSAIL_TASK_ID: 'task-2' },
      providerEnvVars: [],
    });

    expect(prependRuntimePathManifestToPrompt({ prompt: 'Launch prompt.', manifest }))
      .toBe(`${renderAgentRuntimePathManifestForPrompt(manifest)}\n\nLaunch prompt.`);
  });

  it('renders the first-pass product-manager artifact checklist with live paths and required sections', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-test-001',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## Product Manager Artifact Checklist');

    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/implementation-spec.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/intake.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/parallel-ok.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/templates/slice-template.md');
    expect(checklist).toContain('Artifact ownership:');
    expect(checklist).toContain('Read only: intake.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/intake.md). Read it as source context; do not edit it.');
    expect(checklist).toContain('Read only template: slice-template.md (/repo/AgentWorkSpace/templates/slice-template.md). Copy its shape; do not edit the template.');
    expect(checklist).toContain('Write in place: implementation-spec.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/implementation-spec.md). Fill every required section with substantive task-specific content.');
    expect(checklist).toContain('Create and populate: slice-N.md files under /repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps. Copy each from slice-template.md, then populate it.');
    expect(checklist).toContain('Write last: parallel-ok.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/parallel-ok.md). Set Decision to Simple or Complex only after implementation-spec.md and every planned slice are complete.');
    expect(checklist).toContain('Headings, blank lines, HTML comments, and placeholder text are not completion');
    expect(checklist).toContain('Write order: complete implementation-spec.md, create every slice-N.md from slice-template.md, populate every slice, then write parallel-ok.md last.');
    expect(checklist).toContain('Complex requires bullets under Independent Slices that name existing slice-N.md files.');
    for (const section of SPEC_REQUIRED_SECTION_SPECS) {
      expect((checklist.match(new RegExp(`- ${section.preferredHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')) ?? [])).toHaveLength(1);
    }
    expect(checklist).not.toContain(['AgentWorkSpace/tasks', 'active'].join('/'));
  });

  it('renders the first-pass qa artifact checklist with live paths and branch evidence references', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'qa',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-test-001',
        TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform","role":"primary","branch":"task"}]',
        TASKSAIL_TASK_BRANCHES_FILE: '/repo/.platform-state/runtime/tasks/task-test-001/task-branches.json',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## QA Artifact Checklist');

    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/issues.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/final-summary.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/retrospective-input.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/implementation-spec.md');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff');
    expect(checklist).toContain('/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps');
    expect(checklist).toContain('TASKSAIL_TASK_BRANCHES_FILE: /repo/.platform-state/runtime/tasks/task-test-001/task-branches.json');
    expect(checklist).toContain('Artifact ownership:');
    expect(checklist).toContain('Read only: implementation-spec.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/implementation-spec.md), code-changes.diff (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/code-changes.diff), and ImplementationSteps/slice-*.md under /repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps.');
    expect(checklist).toContain('Write for every review outcome: issues.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/issues.md).');
    expect(checklist).toContain('Write only for pass or advisory: retrospective-input.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/retrospective-input.md), then final-summary.md (/repo/AgentWorkSpace/tasks/task-test-001/handoffs/final-summary.md) last.');
    expect(checklist).toContain('Do not edit Alice artifacts or source code during QA.');
    expect(checklist).toContain('First-pass QA write order');
    expect(checklist).toContain('Closeout Owner Agent ID as qa');
    expect(checklist).toContain('write issues.md with concrete verified findings when blocking');
    expect(checklist).toContain('For blocking, issues.md must include a concrete verified Finding, Severity, Finding Type, Required Fix');
    expect(checklist).not.toContain('{"repoId"');
    expect(checklist).not.toContain(['AgentWorkSpace/tasks', 'active'].join('/'));
  });

  it('PM markdown-mode checklist preserves slice-template.md and slice-N.md authoring rules', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-md-001',
        TASKSAIL_SLICE_ARTIFACT_FORMAT: 'markdown',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-md-001/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-md-001/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## Product Manager Artifact Checklist');

    expect(checklist).toContain('slice-template.md');
    expect(checklist).toContain('slice-N.md');
    expect(checklist).toContain('implementation-spec.md remains markdown');
    expect(checklist).toContain('parallel-ok.md');
    expect(checklist).toContain('Preserve every seeded ## and ### heading exactly');
    expect(checklist).toContain('Current Symbols');
    expect(checklist).toContain('Included Symbols');
    expect(checklist).toContain('Excluded Symbols');
    expect(checklist).not.toContain('slice-template.xml');
    expect(checklist).not.toContain('slice-N.xml');
  });

  it('PM xml-mode checklist names slice-template.xml and slice-N.xml', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-xml-001',
        TASKSAIL_SLICE_ARTIFACT_FORMAT: 'xml',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-xml-001/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-xml-001/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## Product Manager Artifact Checklist');

    expect(checklist).toContain('slice-template.xml');
    expect(checklist).toContain('slice-N.xml');
    expect(checklist).toContain('slice-*.xml');
    expect(checklist).toContain('implementation-spec.md and parallel-ok.md are required handoff documents at the paths above.');
    expect(checklist).toContain('parallel-ok.md');
    expect(checklist).toContain('executionSlice XML structure');
    // Reader-side guidance
    expect(checklist).toContain('acceptanceAndValidation/acceptanceCriteria');
    expect(checklist).toContain('filesAndInterfaces/files');
    expect(checklist).toContain('acceptanceAndValidation/validationCommands');
    expect(checklist).toContain('executionScope/currentSymbols');
    expect(checklist).toContain('executionScope/includedSymbols');
    expect(checklist).toContain('executionScope/excludedSymbols');
    expect(checklist).toContain('executionScope/scope');
    expect(checklist).toContain('implementation/requiredChanges');
    // CDATA-for-code guidance (hardened): default plain text, CDATA for code/pseudocode/special chars
    expect(checklist).toContain('Default to plain element text');
    expect(checklist).toContain('CDATA section when it contains code, commands, pseudocode');
    expect(checklist).not.toContain('markdown mode');
    expect(checklist).not.toContain('remains markdown');
    expect(checklist).not.toContain('slice-template.md');
    expect(checklist).not.toContain('slice-N.md');
  });

  it('QA markdown-mode checklist uses slice-*.md glob', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'qa',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-qa-md',
        TASKSAIL_SLICE_ARTIFACT_FORMAT: 'markdown',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-qa-md/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-qa-md/ImplementationSteps',
        TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform","role":"primary","branch":"task"}]',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## QA Artifact Checklist');

    expect(checklist).toContain('ImplementationSteps/slice-*.md');
    expect(checklist).not.toContain('ImplementationSteps/slice-*.xml');
  });

  it('QA xml-mode checklist uses slice-*.xml glob', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'qa',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-qa-xml',
        TASKSAIL_SLICE_ARTIFACT_FORMAT: 'xml',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-qa-xml/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-qa-xml/ImplementationSteps',
        TASKSAIL_TASK_BRANCHES: '[{"repoId":"platform","role":"primary","branch":"task"}]',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## QA Artifact Checklist');

    expect(checklist).toContain('ImplementationSteps/slice-*.xml');
    expect(checklist).not.toContain('ImplementationSteps/slice-*.md');
  });

  it('manifest defaults to markdown format when TASKSAIL_SLICE_ARTIFACT_FORMAT is absent', () => {
    const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-no-format',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-no-format/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-no-format/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    const checklist = renderedSection(rendered, '## Product Manager Artifact Checklist');
    // When absent, defaults to markdown
    expect(checklist).toContain('slice-template.md');
    expect(checklist).toContain('slice-N.md');
  });

  it('TASKSAIL_SLICE_ARTIFACT_FORMAT appears in manifest entries when set', () => {
    const manifest = buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: {
        TASKSAIL_TASK_ID: 'task-fmt',
        TASKSAIL_SLICE_ARTIFACT_FORMAT: 'xml',
        COPILOT_PLATFORM_REPO_ROOT: '/repo',
        COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-fmt/handoffs',
        COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-fmt/ImplementationSteps',
      },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
    });
    const formatEntry = manifest.entries.find((e) => e.name === 'TASKSAIL_SLICE_ARTIFACT_FORMAT');
    expect(formatEntry).toBeDefined();
    expect(formatEntry?.value).toBe('xml');
    expect(formatEntry?.kind).toBe('scalar');
  });

  it('omits role artifact checklists for unsupported agents, missing path inputs, and non-first-pass launch phases', () => {
    const baseEnv = {
      TASKSAIL_TASK_ID: 'task-test-001',
      COPILOT_PLATFORM_REPO_ROOT: '/repo',
      COPILOT_HANDOFFS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/handoffs',
      COPILOT_IMPL_STEPS_DIR: '/repo/AgentWorkSpace/tasks/task-test-001/ImplementationSteps',
    };

    const dalton = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'software-engineer',
      agentCwd: '/repo',
      env: baseEnv,
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    expect(dalton).not.toContain('## Product Manager Artifact Checklist');
    expect(dalton).not.toContain('## QA Artifact Checklist');

    const missingPaths = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
      agentId: 'product-manager',
      agentCwd: '/repo',
      env: { TASKSAIL_TASK_ID: 'task-test-001' },
      providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
      includeRoleArtifactChecklist: true,
    }));
    expect(missingPaths).not.toContain('## Product Manager Artifact Checklist');

    for (const launchPhase of ['Artifact Cleanup', 'Revalidation', 'Retrospective', 'Closeout Remediation', 'Policy Remediation', 'Realignment']) {
      const rendered = renderAgentRuntimePathManifestForPrompt(buildAgentRuntimePathManifest({
        agentId: 'qa',
        launchPhase,
        agentCwd: '/repo',
        env: baseEnv,
        providerEnvVars: copilotProvider.runtimeManifestEnvVars(),
        includeRoleArtifactChecklist: true,
      }));
      expect(rendered).not.toContain('## Product Manager Artifact Checklist');
      expect(rendered).not.toContain('## QA Artifact Checklist');
    }
  });
});
