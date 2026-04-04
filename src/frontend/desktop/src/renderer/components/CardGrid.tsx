import type { ReactNode } from 'react';

import { classNames } from '../utils/classNames';

import '../styles/cardGrid.css';

export type CardGridItemData = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  loading?: boolean;
  onClick?: () => void;
};

export type CardGridProps = {
  items: CardGridItemData[];
  columns?: string;
  emptyMessage?: string;
  className?: string;
  ariaLabel?: string;
};

export default function CardGrid({
  items,
  columns,
  emptyMessage = 'No items.',
  className,
  ariaLabel,
}: CardGridProps): JSX.Element {
  const gridStyle = columns ? { gridTemplateColumns: columns } : undefined;
  const rootClass = classNames('card-grid', className);

  if (items.length === 0) {
    return (
      <div className={rootClass} style={gridStyle} role="list" aria-label={ariaLabel}>
        <div className="card-grid__empty">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className={rootClass} style={gridStyle} role="list" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          className={classNames(
            'card-grid__item',
            item.loading && 'card-grid__item--loading',
          )}
          onClick={item.onClick}
        >
          <span className="card-grid__title-row">
            <span className="card-grid__title">{item.title}</span>
            {item.badge}
          </span>
          {item.subtitle && (
            <span className="card-grid__subtitle">{item.subtitle}</span>
          )}
        </button>
      ))}
    </div>
  );
}
