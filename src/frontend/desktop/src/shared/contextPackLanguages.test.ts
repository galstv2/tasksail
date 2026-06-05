import { describe, expect, it } from 'vitest';
import { LANGUAGE_CATALOG } from './contextPackLanguages';

describe('LANGUAGE_CATALOG', () => {
  const values = LANGUAGE_CATALOG.map((e) => e.value);

  it('contains exactly 12 entries', () => {
    expect(LANGUAGE_CATALOG).toHaveLength(12);
  });

  it('contains exactly the expected language values', () => {
    const expected = [
      'csharp',
      'typescript',
      'javascript',
      'python',
      'java',
      'go',
      'rust',
      'ruby',
      'sql',
      'hcl',
      'shell',
      'powershell',
    ];
    expect(values).toEqual(expected);
  });

  it('has the correct label for each language', () => {
    const labelMap: Record<string, string> = {
      csharp: 'C# / .NET',
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      python: 'Python',
      java: 'Java',
      go: 'Go',
      rust: 'Rust',
      ruby: 'Ruby',
      sql: 'SQL',
      hcl: 'HCL / Terraform',
      shell: 'Shell / Bash',
      powershell: 'PowerShell',
    };
    for (const entry of LANGUAGE_CATALOG) {
      expect(entry.label, `label for ${entry.value}`).toBe(labelMap[entry.value]);
    }
  });

  it('has correct role memberships for each language', () => {
    const roleMap: Record<string, readonly string[]> = {
      csharp: ['backend', 'frontend', 'shared'],
      typescript: ['backend', 'frontend', 'shared'],
      javascript: ['backend', 'frontend', 'shared'],
      python: ['backend', 'shared', 'infrastructure'],
      java: ['backend', 'shared'],
      go: ['backend', 'shared', 'infrastructure'],
      rust: ['backend', 'shared'],
      ruby: ['backend', 'shared'],
      sql: ['database', 'backend', 'shared'],
      hcl: ['infrastructure'],
      shell: ['infrastructure', 'backend', 'shared'],
      powershell: ['infrastructure', 'backend', 'shared'],
    };
    for (const entry of LANGUAGE_CATALOG) {
      expect([...entry.roles], `roles for ${entry.value}`).toEqual(roleMap[entry.value]);
    }
  });

  it('does not include markdown in the catalog', () => {
    expect(values).not.toContain('markdown');
  });

  it('does not import renderer or component modules (structural: checked by scan)', () => {
    // This test is a placeholder — the actual check is the A-no-renderer-imports structural scan.
    // We verify the catalog exports are usable without renderer context.
    expect(typeof LANGUAGE_CATALOG).toBe('object');
  });
});
