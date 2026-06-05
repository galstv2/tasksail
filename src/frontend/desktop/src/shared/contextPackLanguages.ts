// Shared language catalog. SystemLayer is redeclared here as a local type
// so this module has no dependency on any other project module.
export type SystemLayer =
  | 'backend'
  | 'frontend'
  | 'infrastructure'
  | 'database'
  | 'documents'
  | 'shared';

export type LanguageCatalogEntry = {
  value: string;
  label: string;
  roles: ReadonlyArray<SystemLayer>;
};

export const LANGUAGE_CATALOG: readonly LanguageCatalogEntry[] = [
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
