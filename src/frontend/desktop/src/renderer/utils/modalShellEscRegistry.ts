/**
 * Priority-based ESC key registry for stacked modals.
 *
 * Each ModalShell registers its close handler with a numeric priority.
 * On ESC, only the highest-priority active handler fires — preventing
 * stacked modals from both closing on a single keypress.
 *
 * Multiple handlers at the same priority are supported (Set-based).
 * The most recently registered handler at the highest priority fires.
 */

const registry = new Map<number, Set<() => void>>();
let listenerAttached = false;

function onDocumentEsc(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || registry.size === 0) return;
  const maxPriority = Math.max(...registry.keys());
  const handlers = registry.get(maxPriority);
  if (!handlers || handlers.size === 0) return;
  // Fire the last-registered handler at the highest priority
  const arr = [...handlers];
  arr[arr.length - 1]();
  e.stopImmediatePropagation();
  e.preventDefault();
}

function ensureListener(): void {
  if (listenerAttached) return;
  document.addEventListener('keydown', onDocumentEsc, { capture: true });
  listenerAttached = true;
}

export function registerEscHandler(priority: number, handler: () => void): () => void {
  ensureListener();
  let set = registry.get(priority);
  if (!set) {
    set = new Set();
    registry.set(priority, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) registry.delete(priority);
  };
}
