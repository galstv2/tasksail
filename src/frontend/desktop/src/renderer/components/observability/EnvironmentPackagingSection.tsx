import type { EnvironmentStatusResponse } from '../../../shared/desktopContract';
import { classNames } from '../../utils/classNames';

type EnvironmentPackagingSectionProps = {
  environmentStatus: EnvironmentStatusResponse | null;
};

function EnvironmentPackagingSection({ environmentStatus }: EnvironmentPackagingSectionProps): JSX.Element {
  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Environment</h3>
      <p className="obs-section__desc">
        Whether your computer has everything it needs to run this project — the right tools, folders, and settings.
      </p>
      {environmentStatus ? (
        <>
          {environmentStatus.validationSummary && (
            <p className="obs-section__body">{environmentStatus.validationSummary}</p>
          )}

          <div className="obs-kv-list">
            {environmentStatus.hostMode && (
              <div className="obs-kv">
                <span className="obs-kv__label">Mode</span>
                <span className="obs-kv__value">{environmentStatus.hostMode}</span>
              </div>
            )}
            {environmentStatus.repoRoot && (
              <div className="obs-kv">
                <span className="obs-kv__label">Project root</span>
                <span className="obs-kv__value obs-kv__value--mono">{environmentStatus.repoRoot}</span>
              </div>
            )}
            {environmentStatus.packageCommand && (
              <div className="obs-kv">
                <span className="obs-kv__label">Build command</span>
                <span className="obs-kv__value obs-kv__value--mono">{environmentStatus.packageCommand}</span>
              </div>
            )}
            {environmentStatus.launchPolicy && (
              <div className="obs-kv">
                <span className="obs-kv__label">Launch policy</span>
                <span className="obs-kv__value">{environmentStatus.launchPolicy}</span>
              </div>
            )}
          </div>

          {environmentStatus.helperStatuses.length > 0 && (
            <>
              <h4 className="obs-section__subtitle">Required tools</h4>
              <div className="obs-file-list" aria-label="Required tools">
                {environmentStatus.helperStatuses.map((helper) => (
                  <div key={helper.path} className="obs-file-row">
                    <div className="obs-file-row__header">
                      <span className="obs-file-row__name">{helper.label}</span>
                      <span className={classNames('obs-file-row__status', `obs-file-row__status--${helper.available ? 'ok' : 'missing'}`)}>
                        {helper.available ? 'Ready' : 'Missing'}
                      </span>
                    </div>
                    {helper.detail && (
                      <span className="obs-file-row__detail">{helper.detail}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <p className="obs-section__empty">Checking your setup — this will only take a moment.</p>
      )}
    </section>
  );
}

export default EnvironmentPackagingSection;
