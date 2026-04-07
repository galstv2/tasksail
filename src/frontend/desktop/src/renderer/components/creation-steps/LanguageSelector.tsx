import { useState } from 'react';

import { classNames } from '../../utils/classNames';
import { getLanguagesForRole } from './buildWizardConstants';
import { ChevronIcon } from './icons';

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
  const [showMoreLanguages, setShowMoreLanguages] = useState(false);
  const { primary, secondary } = getLanguagesForRole(role);

  return (
    <div className="context-pack-modal__wizard-language">
      <div className="context-pack-modal__wizard-chip-grid">
        {primary.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={classNames(
              'context-pack-modal__wizard-chip',
              language === entry.value && !languageIsOther && 'context-pack-modal__wizard-chip--active',
            )}
            disabled={busy}
            onClick={() => onSelect(entry.value, false)}
          >
            <span className="context-pack-modal__wizard-language-hint">{entry.hint}</span>
            {entry.label}
          </button>
        ))}

        <button
          type="button"
          className={classNames(
            'context-pack-modal__wizard-chip',
            languageIsOther && 'context-pack-modal__wizard-chip--active',
          )}
          disabled={busy}
          onClick={() => onSelect(languageIsOther ? language : '', true)}
        >
          <span className="context-pack-modal__wizard-language-hint">…</span>
          Other
        </button>
      </div>

      {secondary.length > 0 ? (
        <>
          <button
            type="button"
            className={classNames(
              'context-pack-modal__advanced-toggle',
              showMoreLanguages && 'context-pack-modal__advanced-toggle--open',
            )}
            onClick={() => setShowMoreLanguages((previous) => !previous)}
          >
            <ChevronIcon />
            {showMoreLanguages ? 'Less' : 'More languages'}
          </button>

          {showMoreLanguages ? (
            <div className="context-pack-modal__wizard-chip-grid">
              {secondary.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={classNames(
                    'context-pack-modal__wizard-chip',
                    language === entry.value
                      && !languageIsOther
                      && 'context-pack-modal__wizard-chip--active',
                  )}
                  disabled={busy}
                  onClick={() => onSelect(entry.value, false)}
                >
                  <span className="context-pack-modal__wizard-language-hint">{entry.hint}</span>
                  {entry.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {languageIsOther ? (
        <label className="composer-field">
          <span>Language</span>
          <input
            value={language}
            onChange={(event) => onOtherLanguageChange(event.target.value)}
            placeholder="swift"
          />
        </label>
      ) : null}
    </div>
  );
}

export default LanguageSelector;
