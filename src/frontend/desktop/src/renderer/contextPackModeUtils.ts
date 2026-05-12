import type { ContextPackEstateType } from '../shared/desktopContract';

export function isDistributedEstateMode(mode: ContextPackEstateType): boolean {
  return mode === 'distributed' || mode === 'distributed-platform';
}

export function isMonolithEstateMode(mode: ContextPackEstateType): boolean {
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
