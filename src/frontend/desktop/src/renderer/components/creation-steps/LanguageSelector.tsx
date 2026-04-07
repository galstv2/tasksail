import { classNames } from '../../utils/classNames';
import { getLanguagesForRole } from './buildWizardConstants';

type LanguageSelectorProps = {
  busy: boolean;
  role: string;
  language: string;
  languageIsOther: boolean;
  onSelect: (value: string, isOther: boolean) => void;
  onOtherLanguageChange: (value: string) => void;
};

function LanguageSelector({
  busy,
  role,
  language,
  languageIsOther,
  onSelect,
  onOtherLanguageChange,
}: LanguageSelectorProps): JSX.Element {
  const { primary, secondary } = getLanguagesForRole(role);

  return (
    <div className="context-pack-modal__lang-selector">
      <select
        className={classNames(
          'context-pack-modal__inline-select',
          languageIsOther && 'context-pack-modal__inline-select--muted',
        )}
        value={languageIsOther ? '__other__' : language}
        disabled={busy}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '__other__') {
            onSelect('', true);
          } else {
            onSelect(value, false);
          }
        }}
      >
        <option value="" disabled>Choose a language…</option>
        {primary.length > 0 ? (
          <optgroup label="Recommended">
            {primary.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </optgroup>
        ) : null}
        {secondary.length > 0 ? (
          <optgroup label={primary.length > 0 ? 'Other languages' : 'Languages'}>
            {secondary.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </optgroup>
        ) : null}
        <option value="__other__">Other…</option>
      </select>

      {languageIsOther ? (
        <input
          className="context-pack-modal__inline-input"
          value={language}
          onChange={(e) => onOtherLanguageChange(e.target.value)}
          placeholder="e.g. swift"
          disabled={busy}
        />
      ) : null}
    </div>
  );
}

export default LanguageSelector;
