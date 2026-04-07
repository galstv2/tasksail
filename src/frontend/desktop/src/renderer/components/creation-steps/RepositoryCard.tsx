import { useMemo, useState } from 'react';

import { ChevronIcon } from './icons';

import type {
  ContextPackCreationDraft,
  ContextPackCreationModalProps,
  RepositoryEntryDraft,
} from '../../contextPackCreationTypes';
import { classNames } from '../../utils/classNames';
import { toTitleCase } from '../../utils/toTitleCase';

type RepositoryCardProps = {
  repository: RepositoryEntryDraft;
  index: number;
  mode: ContextPackCreationDraft['mode'];
  busy: boolean;
  onRepositoryFieldChange: ContextPackCreationModalProps['onRepositoryFieldChange'];
  onSetPrimaryRepository: ContextPackCreationModalProps['onSetPrimaryRepository'];
  onRemoveRepository: ContextPackCreationModalProps['onRemoveRepository'];
};

function countConfiguredAdvanced(repo: RepositoryEntryDraft): number {
  let count = 0;
  if (repo.repoId.trim()) count++;
  if (repo.languages.trim()) count++;
  if (repo.artifactRoots.trim()) count++;
  if (repo.documentPaths.trim()) count++;
  if (repo.boundedContext.trim()) count++;
  if (repo.serviceName.trim()) count++;
  return count;
}

function RepositoryCard({
  repository,
  index,
  mode,
  busy,
  onRepositoryFieldChange,
  onSetPrimaryRepository,
  onRemoveRepository,
}: RepositoryCardProps): JSX.Element {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedCount = useMemo(() => countConfiguredAdvanced(repository), [repository]);

  return (
    <article
      className={classNames(
        'context-pack-modal__editor-card',
        repository.primary && 'context-pack-modal__editor-card--primary',
      )}
    >
      <div className="panel__title-row context-pack-modal__card-header">
        <div>
          <span className="context-pack-modal__card-label">
            {mode === 'monolith' && index === 0
              ? 'Main repository'
              : `Repository ${index + 1}`}
          </span>
          <p className="panel__meta">
            {repository.primary
              ? 'Agents will work in this repository.'
              : 'Available to agents as context.'}
          </p>
        </div>
        {index > 0 ? (
          <button
            type="button"
            className="action-button action-button--secondary"
            disabled={busy}
            onClick={() => onRemoveRepository(repository.key)}
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="context-pack-modal__grid">
        <label className="composer-field">
          <span>Repo root</span>
          <input
            value={repository.repoRoot}
            onChange={(event) =>
              onRepositoryFieldChange(repository.key, 'repoRoot', event.target.value)
            }
          />
        </label>
        <label className="composer-field">
          <span>Display name</span>
          <input
            value={repository.repoName}
            onChange={(event) =>
              onRepositoryFieldChange(repository.key, 'repoName', event.target.value)
            }
          />
        </label>
        <label className="composer-field">
          <span>System layer</span>
          <select
            value={repository.systemLayer}
            onChange={(event) =>
              onRepositoryFieldChange(repository.key, 'systemLayer', event.target.value)
            }
          >
            {[
              'backend',
              'frontend',
              'infrastructure',
              'database',
              'documents',
              'shared',
            ].map((option) => (
              <option key={option} value={option}>
                {toTitleCase(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="button"
        className={classNames(
          'context-pack-modal__advanced-toggle',
          advancedOpen && 'context-pack-modal__advanced-toggle--open',
        )}
        onClick={() => setAdvancedOpen((prev) => !prev)}
      >
        <ChevronIcon />
        {advancedOpen
          ? 'Hide advanced fields'
          : advancedCount > 0
            ? `${advancedCount} advanced field${advancedCount !== 1 ? 's' : ''} configured`
            : 'Show advanced fields'}
      </button>

      {advancedOpen && (
        <div className="context-pack-modal__advanced-fields">
          <label className="composer-field">
            <span>Repo ID</span>
            <input
              value={repository.repoId}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'repoId', event.target.value)
              }
            />
          </label>
          <label className="composer-field">
            <span>Languages</span>
            <input
              value={repository.languages}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'languages', event.target.value)
              }
              placeholder="python, typescript"
            />
          </label>
          <label className="composer-field">
            <span>Artifact roots</span>
            <input
              value={repository.artifactRoots}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'artifactRoots', event.target.value)
              }
              placeholder="src, packages"
            />
          </label>
          <label className="composer-field">
            <span>Document paths</span>
            <input
              value={repository.documentPaths}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'documentPaths', event.target.value)
              }
              placeholder="docs"
            />
          </label>
          <label className="composer-field">
            <span>Bounded context</span>
            <input
              value={repository.boundedContext}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'boundedContext', event.target.value)
              }
            />
          </label>
          <label className="composer-field">
            <span>Service name</span>
            <input
              value={repository.serviceName}
              onChange={(event) =>
                onRepositoryFieldChange(repository.key, 'serviceName', event.target.value)
              }
            />
          </label>
        </div>
      )}

      <button
        type="button"
        className={classNames(
          'context-pack-modal__toggle-pill',
          repository.primary && 'context-pack-modal__toggle-pill--active',
        )}
        onClick={() => onSetPrimaryRepository(repository.key)}
        aria-pressed={repository.primary}
      >
        <span className="context-pack-modal__toggle-dot" />
        Start from here
      </button>
    </article>
  );
}

export default RepositoryCard;
