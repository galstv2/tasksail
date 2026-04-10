import { classNames } from '../utils/classNames';

export type BreadcrumbItem = {
  key: string;
  label: string;
  action: (() => void) | null;
};

type DeepFocusBreadcrumbProps = {
  visibleBreadcrumbs: BreadcrumbItem[];
  hiddenBreadcrumbs: BreadcrumbItem[];
};

function OverflowDotsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="4" cy="8" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DeepFocusBreadcrumb({
  visibleBreadcrumbs,
  hiddenBreadcrumbs,
}: DeepFocusBreadcrumbProps): JSX.Element {
  return (
    <div className="deep-focus-breadcrumb" aria-label="Deep Focus breadcrumb">
      {hiddenBreadcrumbs.length > 0 ? (
        <details className="deep-focus-breadcrumb__overflow">
          <summary className="deep-focus-breadcrumb__segment" aria-label="Show hidden breadcrumb segments">
            <OverflowDotsIcon />
          </summary>
          <div className="deep-focus-breadcrumb__menu">
            {hiddenBreadcrumbs.map((crumb) => (
              <button
                key={crumb.key}
                type="button"
                className="deep-focus-breadcrumb__menu-item"
                onClick={crumb.action ?? undefined}
              >
                {crumb.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {visibleBreadcrumbs.map((crumb, index) => {
        const isLast = index === visibleBreadcrumbs.length - 1;
        return (
          <div key={crumb.key} className="deep-focus-breadcrumb__item">
            {isLast || !crumb.action ? (
              <span className={classNames('deep-focus-breadcrumb__segment', 'deep-focus-breadcrumb__segment--current')}>
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                className="deep-focus-breadcrumb__segment"
                onClick={crumb.action}
              >
                {crumb.label}
              </button>
            )}
            {!isLast ? (
              <span className="deep-focus-breadcrumb__separator" aria-hidden="true">
                <ChevronRightIcon />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
