import type { RepositoryEntryDraft } from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';
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
    <div className="context-pack-modal__wizard-chip-grid">
      {ROLE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={classNames(
            'context-pack-modal__wizard-chip',
            selectedRole === option.value && 'context-pack-modal__wizard-chip--active',
          )}
          disabled={busy}
          onClick={() => onSelect(option.value)}
          title={option.description}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default RoleSelector;
