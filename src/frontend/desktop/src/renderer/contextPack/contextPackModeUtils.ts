import type { ContextPackEstateType } from '../../shared/desktopContract';

type MaybeContextPackEstateMode = ContextPackEstateType | string | null | undefined;

export function isDistributedEstateMode(mode: MaybeContextPackEstateMode): boolean {
  return mode === 'distributed' || mode === 'distributed-platform';
}

export function isMonolithEstateMode(mode: MaybeContextPackEstateMode): boolean {
  return mode === 'monolith' || mode === 'monolith-platform';
}

export function contextPackModeLabel(mode: ContextPackEstateType): string {
  switch (mode) {
    case 'distributed':
      return 'Distributed';
    case 'distributed-platform':
      return 'Distributed + infrastructure';
    case 'monolith':
      return 'Monolith';
    case 'monolith-platform':
      return 'Monolith + infrastructure';
  }
}
