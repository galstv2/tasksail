import { useEffect, useState } from 'react';

type WizardLocationProps = {
  busy: boolean;
  discoveryRoot: string;
  onDiscoveryRootChange: (value: string) => void;
  onBrowseDiscoveryRoot: () => void | Promise<void>;
  onContinue: () => void;
};

function WizardLocation({
  busy,
  discoveryRoot,
  onDiscoveryRootChange,
  onBrowseDiscoveryRoot,
  onContinue,
}: WizardLocationProps): JSX.Element {
  const [pendingBrowseAdvance, setPendingBrowseAdvance] = useState(false);

  useEffect(() => {
    if (!pendingBrowseAdvance || !discoveryRoot.trim()) {
      return;
    }
    setPendingBrowseAdvance(false);
    onContinue();
  }, [discoveryRoot, onContinue, pendingBrowseAdvance]);

  return (
    <section className="context-pack-modal__wizard-section">
      <p className="context-pack-modal__wizard-heading">
        Where should your project live?
      </p>

      <label className="composer-field">
        <span>Folder</span>
        <div className="context-pack-modal__path-row">
          <input
            value={discoveryRoot}
            onChange={(event) => onDiscoveryRootChange(event.target.value)}
          />
          <button
            type="button"
            className="action-button action-button--secondary"
            disabled={busy}
            onClick={async () => {
              setPendingBrowseAdvance(true);
              await onBrowseDiscoveryRoot();
            }}
          >
            Browse
          </button>
        </div>
      </label>
    </section>
  );
}

export default WizardLocation;
