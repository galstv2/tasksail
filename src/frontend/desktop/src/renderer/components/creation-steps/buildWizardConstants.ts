import type {
  BuildWizardStep,
  PartDraft,
  RepositoryEntryDraft,
} from '../../contextPackCreationTypes';

export type LanguageEntry = {
  value: string;
  label: string;
  hint: string;
  category: 'application' | 'support';
  roles: ReadonlyArray<RepositoryEntryDraft['systemLayer']>;
};

export const LANGUAGE_CATALOG: readonly LanguageEntry[] = [
  { value: 'csharp', label: 'C# / .NET', hint: '#', category: 'application', roles: ['backend', 'frontend', 'shared'] },
  { value: 'typescript', label: 'TypeScript', hint: 'TS', category: 'application', roles: ['backend', 'frontend', 'shared'] },
  { value: 'javascript', label: 'JavaScript', hint: 'JS', category: 'application', roles: ['backend', 'frontend', 'shared'] },
  { value: 'python', label: 'Python', hint: 'Py', category: 'application', roles: ['backend', 'shared', 'infrastructure'] },
  { value: 'java', label: 'Java', hint: 'J', category: 'application', roles: ['backend', 'shared'] },
  { value: 'go', label: 'Go', hint: 'Go', category: 'application', roles: ['backend', 'shared', 'infrastructure'] },
  { value: 'rust', label: 'Rust', hint: 'Rs', category: 'application', roles: ['backend', 'shared'] },
  { value: 'ruby', label: 'Ruby', hint: 'Rb', category: 'application', roles: ['backend', 'shared'] },
  { value: 'sql', label: 'SQL', hint: 'SQL', category: 'support', roles: ['database', 'backend', 'shared'] },
  { value: 'hcl', label: 'HCL / Terraform', hint: 'HCL', category: 'support', roles: ['infrastructure'] },
  { value: 'shell', label: 'Shell / Bash', hint: 'sh', category: 'support', roles: ['infrastructure', 'backend', 'shared'] },
  { value: 'powershell', label: 'PowerShell', hint: 'PS', category: 'support', roles: ['infrastructure', 'backend', 'shared'] },
] as const;

export type RoleOption = {
  value: RepositoryEntryDraft['systemLayer'];
  label: string;
  description: string;
  shortLabel: string;
};

export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'backend', label: 'Backend / API', description: 'Server-side code, APIs, and services', shortLabel: 'API' },
  { value: 'frontend', label: 'Frontend / UI', description: 'User interfaces and client-side code', shortLabel: 'Frontend' },
  { value: 'database', label: 'Database', description: 'Schemas, migrations, and queries', shortLabel: 'Database' },
  { value: 'infrastructure', label: 'Infrastructure', description: 'DevOps, CI/CD, and cloud config', shortLabel: 'Infrastructure' },
  { value: 'documents', label: 'Documentation', description: 'Docs, specs, and reference material', shortLabel: 'Docs' },
  { value: 'shared', label: 'Shared / Library', description: 'Code shared across other parts', shortLabel: 'Shared' },
] as const;

export const WIZARD_STEPS: readonly { key: BuildWizardStep; label: string }[] = [
  { key: 'project-type', label: 'Project type' },
  { key: 'location', label: 'Location' },
  { key: 'project-name', label: 'Name' },
  { key: 'build-parts', label: 'Build' },
] as const;

export function getLanguagesForRole(
  role: string,
): { primary: LanguageEntry[]; secondary: LanguageEntry[] } {
  const primary = LANGUAGE_CATALOG.filter((lang) =>
    lang.roles.includes(role as RepositoryEntryDraft['systemLayer']),
  );
  const secondary = LANGUAGE_CATALOG.filter((lang) =>
    !lang.roles.includes(role as RepositoryEntryDraft['systemLayer']),
  );
  return { primary, secondary };
}

export function getRoleOption(role: string): RoleOption | undefined {
  return ROLE_OPTIONS.find((option) => option.value === role);
}

export function getLanguageEntry(language: string): LanguageEntry | undefined {
  return LANGUAGE_CATALOG.find((entry) => entry.value === language);
}

export function isWizardPartConfigured(part: PartDraft): boolean {
  return Boolean(part.role && part.language.trim());
}
