import type { RepositoryEntryDraft } from '../../contextPack/contextPackCreationTypes';
import { ROLE_OPTIONS } from './buildWizardConstants';

type RoleSelectorProps = {
  busy: boolean;
  selectedRole: RepositoryEntryDraft['systemLayer'] | '';
  onSelect: (role: RepositoryEntryDraft['systemLayer']) => void;
  excludeRoles?: ReadonlyArray<RepositoryEntryDraft['systemLayer']>;
};

function RoleSelector({
  busy,
  selectedRole,
  onSelect,
  excludeRoles,
}: RoleSelectorProps): JSX.Element {
  const visibleOptions = excludeRoles && excludeRoles.length > 0
    ? ROLE_OPTIONS.filter((option) => !excludeRoles.includes(option.value))
    : ROLE_OPTIONS;
  return (
    <select
      className="context-pack-modal__inline-select"
      value={selectedRole}
      disabled={busy}
      onChange={(e) => {
        if (e.target.value) {
          onSelect(e.target.value as RepositoryEntryDraft['systemLayer']);
        }
      }}
    >
      <option value="" disabled>Choose a role…</option>
      {visibleOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default RoleSelector;
