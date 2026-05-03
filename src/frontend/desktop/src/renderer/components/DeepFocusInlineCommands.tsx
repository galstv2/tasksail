import { actionKey, actionTone, type ScopedRoleAction, type PopoverAction } from './SidebarDeepFocusUtils';
import { classNames } from '../utils/classNames';
import type { TreeRowData } from './DeepFocusTreeRow';

type DeepFocusInlineCommandsProps = {
  row: TreeRowData;
  actions: PopoverAction[];
  onAction: (action: ScopedRoleAction) => void;
};

export function DeepFocusInlineCommands({
  row,
  actions,
  onAction,
}: DeepFocusInlineCommandsProps): JSX.Element {
  const nonDestructiveActions: Array<{ entry: PopoverAction; tone: ReturnType<typeof actionTone> }> = [];
  const destructiveActions: PopoverAction[] = [];
  for (const entry of actions) {
    const tone = actionTone(entry.action);
    if (tone === 'destructive') {
      destructiveActions.push(entry);
    } else {
      nonDestructiveActions.push({ entry, tone });
    }
  }

  const hasDistinctPath = Boolean(row.displayPath) && row.displayPath !== row.label;

  return (
    <section
      className="deep-focus-inline-commands"
      aria-label="Selected row actions"
    >
      <div className="deep-focus-inline-commands__meta">
        <span className="deep-focus-inline-commands__target" title={row.label}>
          {row.label}
        </span>
        {hasDistinctPath ? (
          <span className="deep-focus-inline-commands__path" title={row.displayPath}>
            {row.displayPath}
          </span>
        ) : null}
      </div>
      <div className="deep-focus-inline-commands__buttons">
        {nonDestructiveActions.map(({ entry, tone }) => (
          <button
            key={actionKey(entry.action)}
            type="button"
            className={classNames(
              'deep-focus-inline-commands__button',
              tone === 'primary' && 'deep-focus-inline-commands__button--primary',
            )}
            disabled={entry.disabled}
            onClick={() => onAction(entry.action)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
              }
            }}
            aria-label={entry.label}
          >
            {entry.shortLabel ?? entry.label}
          </button>
        ))}
        {destructiveActions.map((entry) => (
          <button
            key={actionKey(entry.action)}
            type="button"
            className="deep-focus-inline-commands__button deep-focus-inline-commands__button--destructive"
            disabled={entry.disabled}
            onClick={() => onAction(entry.action)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
              }
            }}
            aria-label={entry.label}
          >
            {entry.shortLabel ?? entry.label}
          </button>
        ))}
      </div>
    </section>
  );
}
