import { useState } from 'react';

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

function ChevronIcon(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
      <div className="context-pack-modal__wizard-choice-grid">
        {primary.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className={classNames(
              'context-pack-modal__editor-card',
              'context-pack-modal__wizard-select-card',
              language === entry.value && !languageIsOther && 'context-pack-modal__editor-card--active',
            )}
            disabled={busy}
            onClick={() => onSelect(entry.value, false)}
          >
            <strong>{entry.label}</strong>
            <span className="context-pack-modal__wizard-language-hint">{entry.hint}</span>
          </button>
        ))}

        <button
          type="button"
          className={classNames(
            'context-pack-modal__editor-card',
            'context-pack-modal__wizard-select-card',
            languageIsOther && 'context-pack-modal__editor-card--active',
          )}
          disabled={busy}
          onClick={() => onSelect(languageIsOther ? language : '', true)}
        >
          <strong>Other</strong>
          <span className="context-pack-modal__wizard-language-hint">…</span>
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
            {showMoreLanguages ? 'Hide more languages' : 'Show more languages'}
          </button>

          {showMoreLanguages ? (
            <div className="context-pack-modal__wizard-choice-grid context-pack-modal__wizard-choice-grid--compact">
              {secondary.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  className={classNames(
                    'context-pack-modal__editor-card',
                    'context-pack-modal__wizard-select-card',
                    language === entry.value
                      && !languageIsOther
                      && 'context-pack-modal__editor-card--active',
                  )}
                  disabled={busy}
                  onClick={() => onSelect(entry.value, false)}
                >
                  <strong>{entry.label}</strong>
                  <span className="context-pack-modal__wizard-language-hint">{entry.hint}</span>
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
