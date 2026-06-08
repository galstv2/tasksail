import { useMemo, useState } from 'react';

import { ChevronIcon, CloseIcon } from '../icons';

import type {
  ContextPackCreationDraft,
  ContextPackCreationModalProps,
  RepositoryEntryDraft,
} from '../../contextPack/contextPackCreationTypes';
import { isMonolithEstateMode } from '../../contextPack/contextPackModeUtils';
import { classNames } from '../../utils/classNames';
import { toTitleCase } from '../../utils/toTitleCase';

type RepositoryCardProps = {
  repository: RepositoryEntryDraft;
  index: number;
  mode: ContextPackCreationDraft['mode'];
  busy: boolean;
  onRepositoryFieldChange: ContextPackCreationModalProps['onRepositoryFieldChange'];
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
  onRemoveRepository,
}: RepositoryCardProps): JSX.Element {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedCount = useMemo(() => countConfiguredAdvanced(repository), [repository]);

  return (
    <article className="context-pack-modal__editor-card">
      <div className="panel__title-row context-pack-modal__card-header">
        <div>
          <span className="context-pack-modal__card-label">
            {isMonolithEstateMode(mode) && index === 0
              ? 'Main repository'
              : `Repository ${index + 1}`}
          </span>
        </div>
        <div className="context-pack-modal__card-header-actions">
          {index > 0 ? (
            <button
              type="button"
              className="context-pack-modal__icon-btn context-pack-modal__icon-btn--danger"
              disabled={busy}
              onClick={() => onRemoveRepository(repository.key)}
              aria-label="Remove"
              title="Remove repository"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
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
        <label className="composer-field">
          <span>Category</span>
          <select
            value={repository.repoCategory}
            onChange={(event) =>
              onRepositoryFieldChange(repository.key, 'repoCategory', event.target.value)
            }
          >
            {[
              'service',
              'application',
              'frontend',
              'library',
              'infrastructure',
              'data',
              'documentation',
              'tool',
              'unknown',
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
    </article>
  );
}

export default RepositoryCard;
