/**
 * The overlay layer stack (P1.9). Every modal-like layer (Modal, Drawer, Popover, command palette, mobile nav, …)
 * registers while open via useFocusTrap; Escape closes ONLY the top-most layer. Before this, each overlay put its own
 * Escape listener on `document`, so Escape inside a popover over a drawer closed both (Popover worked around it with
 * stopPropagation; nothing else did).
 *
 * Module-level and framework-free: one document listener, installed on first use.
 */

interface Layer {
  id: number;
  onEscape: () => void;
}

const stack: Layer[] = [];
let nextId = 1;
let installed = false;

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const top = stack.at(-1);
  if (!top) return;
  event.preventDefault();
  top.onEscape();
}

/** Register an open layer. Register once when the layer opens (keep `onEscape` current through a ref) and call `pop`
 * when it closes — re-registering on every render would reorder the stack. */
export function pushLayer(onEscape: () => void): { id: number; pop: () => void } {
  if (!installed && typeof document !== "undefined") {
    document.addEventListener("keydown", onKeyDown);
    installed = true;
  }
  const layer: Layer = { id: nextId++, onEscape };
  stack.push(layer);
  return {
    id: layer.id,
    pop: () => {
      const index = stack.findIndex((l) => l.id === layer.id);
      if (index !== -1) stack.splice(index, 1);
    },
  };
}

/** True while any overlay is open — global shortcuts (g-chords, `c`, `?`, `/`) stand down until it closes. */
export function hasOpenLayer(): boolean {
  return stack.length > 0;
}

/** Whether the layer with this id is the top-most one (key handling that belongs to the top layer only). */
export function isTopLayer(id: number | null): boolean {
  return id !== null && stack.at(-1)?.id === id;
}

/** Test-only: empty the stack. */
export function resetLayerStackForTests(): void {
  stack.length = 0;
}
