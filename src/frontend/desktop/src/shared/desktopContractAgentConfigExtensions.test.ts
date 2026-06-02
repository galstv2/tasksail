import { describe, expect, it } from 'vitest';

import { validateDesktopActionRequest } from './desktopContractValidators';

// ── agentConfig.listExtensions ────────────────────────────────────────────────

describe('agentConfig.listExtensions validator', () => {
  it('accepts a request with no payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.listExtensions' }),
    ).toEqual([]);
  });

  it('rejects explicit payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.listExtensions', payload: {} }),
    ).not.toHaveLength(0);
  });
});

// ── agentConfig.addExtension ──────────────────────────────────────────────────

describe('agentConfig.addExtension validator', () => {
  it('accepts a valid git source request', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-skill',
          kind: 'skill',
          provider_id: 'copilot',
          source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
        },
      }),
    ).toEqual([]);
  });

  it('accepts a valid local source request', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-plugin',
          kind: 'plugin',
          provider_id: 'copilot',
          source: { type: 'local', path: '/some/path' },
        },
      }),
    ).toEqual([]);
  });

  it('accepts a valid direct-attachment skill request', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-skill',
          kind: 'skill',
          provider_id: 'copilot',
          source: { type: 'direct-attachment', skill_markdown: '# My Skill\nDoes things.' },
        },
      }),
    ).toEqual([]);
  });

  it('rejects plugin + direct-attachment (V1 restriction)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'bad-plugin',
        kind: 'plugin',
        provider_id: 'copilot',
        source: { type: 'direct-attachment', skill_markdown: '# Something' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/direct-attachment/i);
  });

  it('rejects invalid ID pattern (uppercase)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'My-Skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects ID starting with a hyphen', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: '-bad',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing git url', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'git', url: '', ref: 'main' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing git ref', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: '' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing local path', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'local', path: '' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects empty skill_markdown in direct-attachment', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'copilot',
        source: { type: 'direct-attachment', skill_markdown: '' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.addExtension' }),
    ).not.toHaveLength(0);
  });

  it('accepts a well-formed provider_id without hardcoded membership validation', () => {
    expect(validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: 'openai',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
      },
    })).toEqual([]);
  });

  it('rejects missing provider_id structurally', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-skill',
        kind: 'skill',
        provider_id: '',
        source: { type: 'git', url: 'https://github.com/org/repo', ref: 'main' },
      },
    });
    expect(errors).toContain('payload.provider_id must be a non-empty string.');
  });
});

// ── agentConfig.reseedExtension ───────────────────────────────────────────────

describe('agentConfig.reseedExtension validator', () => {
  it('accepts a valid ID', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.reseedExtension',
        payload: { id: 'my-skill' },
      }),
    ).toEqual([]);
  });

  it('rejects invalid ID', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.reseedExtension',
      payload: { id: 'BAD_ID' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.reseedExtension' }),
    ).not.toHaveLength(0);
  });
});

// ── agentConfig.deleteExtension ───────────────────────────────────────────────

describe('agentConfig.deleteExtension validator', () => {
  it('accepts a valid ID', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.deleteExtension',
        payload: { id: 'my-skill' },
      }),
    ).toEqual([]);
  });

  it('rejects invalid ID', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.deleteExtension',
      payload: { id: '' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a remove_assignments boolean', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.deleteExtension',
        payload: { id: 'my-skill', remove_assignments: true },
      }),
    ).toEqual([]);
  });

  it('rejects a non-boolean remove_assignments', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.deleteExtension',
      payload: { id: 'my-skill', remove_assignments: 'yes' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── agentConfig.loadExtensionAssignments ──────────────────────────────────────

describe('agentConfig.loadExtensionAssignments validator', () => {
  it('accepts a request with no payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.loadExtensionAssignments' }),
    ).toEqual([]);
  });

  it('rejects explicit payload', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.loadExtensionAssignments',
        payload: { extra: 'field' },
      }),
    ).not.toHaveLength(0);
  });
});

// ── agentConfig.saveExtensionAssignments ──────────────────────────────────────

describe('agentConfig.saveExtensionAssignments validator', () => {
  it('accepts a valid assignment array', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: {
          assignments: [
            { agent_id: 'software-engineer', extension_ids: ['my-skill'] },
            { agent_id: 'qa', extension_ids: [] },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('accepts all valid agent IDs', () => {
    for (const agent_id of [
      'planning-agent',
      'product-manager',
      'software-engineer',
      'software-engineer-verify',
      'qa',
    ]) {
      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.saveExtensionAssignments',
          payload: { assignments: [{ agent_id, extension_ids: [] }] },
        }),
      ).toEqual([]);
    }
  });

  it('accepts a well-formed but unrecognized agent ID (membership enforced at the save handler)', () => {
    // The dispatch validator is structural-only; roster membership is enforced at the
    // Electron save handler against the provider descriptor, not here.
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: { assignments: [{ agent_id: 'super-agent', extension_ids: [] }] },
      }),
    ).toEqual([]);
  });

  it('rejects a missing or empty agent_id (structural check)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: { assignments: [{ agent_id: '', extension_ids: [] }] },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: { assignments: [{ extension_ids: [] }] },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('rejects invalid extension_id in the array', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: {
        assignments: [
          { agent_id: 'software-engineer', extension_ids: ['BAD_ID'] },
        ],
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-array assignments', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: 'not-an-array' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects missing payload', () => {
    expect(
      validateDesktopActionRequest({ action: 'agentConfig.saveExtensionAssignments' }),
    ).not.toHaveLength(0);
  });
});

// ── Track F: Skills & Plugins / Agents tab confirmation ───────────────────────

describe('agentConfig.saveExtensionAssignments: stable-ID contract enforcement', () => {
  it('accepts a valid stable-ID assignment for all canonical agent IDs', () => {
    for (const agent_id of ['planning-agent', 'product-manager', 'software-engineer', 'software-engineer-verify', 'qa'] as const) {
      expect(
        validateDesktopActionRequest({
          action: 'agentConfig.saveExtensionAssignments',
          payload: { assignments: [{ agent_id, extension_ids: ['phase2-skill-a'] }] },
        }),
      ).toEqual([]);
    }
  });

  it('accepts an empty extension_ids array (agent with no extensions assigned)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: { assignments: [{ agent_id: 'qa', extension_ids: [] }] },
      }),
    ).toEqual([]);
  });

  it('accepts multiple extension IDs in a single agent assignment', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: {
          assignments: [
            { agent_id: 'software-engineer', extension_ids: ['skill-a', 'plugin-b', 'phase2-cobalt-plugin'] },
          ],
        },
      }),
    ).toEqual([]);
  });

  it('accepts a well-formed unrecognized agent ID; roster membership is enforced at the save handler', () => {
    // Structural-only dispatch validation: an unknown but well-formed agent_id passes
    // here and is rejected downstream at the Electron save handler.
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.saveExtensionAssignments',
        payload: { assignments: [{ agent_id: 'sre-agent', extension_ids: [] }] },
      }),
    ).toEqual([]);
  });

  it('rejects an extension ID that fails the slug pattern (uppercase not allowed)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: [{ agent_id: 'qa', extension_ids: ['My-Skill'] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an extension ID starting with a hyphen', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: [{ agent_id: 'qa', extension_ids: ['-bad-id'] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an extension ID that is an empty string', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: [{ agent_id: 'qa', extension_ids: [''] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a payload where assignments is an object instead of an array (malformed shape)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: { 'software-engineer': ['my-skill'] } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects assignment entries that are not objects (malformed shape)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: ['planning-agent:my-skill'] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects extension_ids that contain a path separator (not a slug)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.saveExtensionAssignments',
      payload: { assignments: [{ agent_id: 'qa', extension_ids: ['path/to/skill'] }] },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('agentConfig.addExtension: plugin direct-attachment rejection (V1 restriction)', () => {
  it('rejects plugin + direct-attachment with an explanatory message', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.addExtension',
      payload: {
        id: 'my-plugin',
        kind: 'plugin',
        provider_id: 'copilot',
        source: { type: 'direct-attachment', skill_markdown: '# Something' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/direct-attachment/i);
  });

  it('accepts skill + direct-attachment (plugin restriction is NOT applied to skills)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-skill',
          kind: 'skill',
          provider_id: 'copilot',
          source: { type: 'direct-attachment', skill_markdown: '# My Skill\nDoes things.' },
        },
      }),
    ).toEqual([]);
  });

  it('accepts plugin + local source (V1 supported path)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-plugin',
          kind: 'plugin',
          provider_id: 'copilot',
          source: { type: 'local', path: '/extensions/my-plugin' },
        },
      }),
    ).toEqual([]);
  });

  it('accepts plugin + git source (V1 supported path)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.addExtension',
        payload: {
          id: 'my-plugin',
          kind: 'plugin',
          provider_id: 'copilot',
          source: { type: 'git', url: 'https://github.com/org/plugin-repo', ref: 'main' },
        },
      }),
    ).toEqual([]);
  });
});

describe('agentConfig.reseedExtension: manual reseed contract', () => {
  it('accepts a valid lowercase-slug ID', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.reseedExtension',
        payload: { id: 'phase2-ferret-skill' },
      }),
    ).toEqual([]);
  });

  it('accepts the plugin manifest-slug-style ID (plugin display_name is its catalog id)', () => {
    expect(
      validateDesktopActionRequest({
        action: 'agentConfig.reseedExtension',
        payload: { id: 'phase2-cobalt-plugin' },
      }),
    ).toEqual([]);
  });

  it('rejects an ID with uppercase (plugin manifest slugs must be lowercase)', () => {
    const errors = validateDesktopActionRequest({
      action: 'agentConfig.reseedExtension',
      payload: { id: 'Phase2-Cobalt-Plugin' },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
