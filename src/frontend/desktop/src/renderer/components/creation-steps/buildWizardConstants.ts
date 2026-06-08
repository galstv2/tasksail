import type {
  BuildWizardStep,
  PartDraft,
  RepositoryEntryDraft,
} from '../../contextPack/contextPackCreationTypes';
import {
  LANGUAGE_CATALOG,
  type LanguageCatalogEntry,
} from '../../../shared/contextPackLanguages';

export type { LanguageCatalogEntry };
// LanguageEntry is kept as an alias for backward compatibility.
export type LanguageEntry = LanguageCatalogEntry;

export { LANGUAGE_CATALOG };

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
