import type {
  BuildWizardStep,
  PartDraft,
  RepositoryEntryDraft,
} from '../../contextPackCreationTypes';

export type LanguageEntry = {
  value: string;
  label: string;
  roles: ReadonlyArray<RepositoryEntryDraft['systemLayer']>;
};

export const LANGUAGE_CATALOG: readonly LanguageEntry[] = [
  { value: 'csharp', label: 'C# / .NET', roles: ['backend', 'frontend', 'shared'] },
  { value: 'typescript', label: 'TypeScript', roles: ['backend', 'frontend', 'shared'] },
  { value: 'javascript', label: 'JavaScript', roles: ['backend', 'frontend', 'shared'] },
  { value: 'python', label: 'Python', roles: ['backend', 'shared', 'infrastructure'] },
  { value: 'java', label: 'Java', roles: ['backend', 'shared'] },
  { value: 'go', label: 'Go', roles: ['backend', 'shared', 'infrastructure'] },
  { value: 'rust', label: 'Rust', roles: ['backend', 'shared'] },
  { value: 'ruby', label: 'Ruby', roles: ['backend', 'shared'] },
  { value: 'sql', label: 'SQL', roles: ['database', 'backend', 'shared'] },
  { value: 'hcl', label: 'HCL / Terraform', roles: ['infrastructure'] },
  { value: 'shell', label: 'Shell / Bash', roles: ['infrastructure', 'backend', 'shared'] },
  { value: 'powershell', label: 'PowerShell', roles: ['infrastructure', 'backend', 'shared'] },
] as const;

export type RoleOption = {
  value: RepositoryEntryDraft['systemLayer'];
  label: string;
};

export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'backend', label: 'Backend / API' },
  { value: 'frontend', label: 'Frontend / UI' },
  { value: 'database', label: 'Database' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'documents', label: 'Documentation' },
  { value: 'shared', label: 'Shared / Library' },
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
