import type { RepositoryEntryDraft } from '../../contextPackCreationTypes';
import { ROLE_OPTIONS } from './buildWizardConstants';

type RoleSelectorProps = {
  busy: boolean;
  selectedRole: RepositoryEntryDraft['systemLayer'] | '';
  onSelect: (role: RepositoryEntryDraft['systemLayer']) => void;
};

function RoleSelector({
  busy,
  selectedRole,
  onSelect,
}: RoleSelectorProps): JSX.Element {
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
      {ROLE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export default RoleSelector;
