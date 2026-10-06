/**
 * The admin keyboard shortcut registry (P1.9) — every reserved key, named once. Components bind behaviour to an id with
 * `useShortcut(id, handler)` (hooks/use-shortcut.ts); the keys live only here, the `?` help dialog lists this table, and a
 * guard test rejects two shortcuts claiming the same keys in the same scope.
 *
 * Scopes: `global` (anywhere in the admin, stands down while an overlay is open), `list` (a focused DataTable),
 * `drawer` (the top-most drawer), `form` (a form with unsaved work), `layer` (the overlay layer stack itself).
 *
 * Deliberately NOT reserved: `[` / `]`.
 */

export type ShortcutScope = "global" | "list" | "drawer" | "form" | "layer";

export interface ShortcutDefinition {
  /** Canonical combo (lib/keyboard.ts comboOf), or a two-key chord `"g *"` whose second key is passed to the handler. */
  keys: string;
  /** How the help dialog writes it. */
  display: string;
  description: string;
  scope: ShortcutScope;
  group: "General" | "Go to" | "Lists" | "Drawers" | "Forms";
  /** Fires even while focus is in a text field (modifier combos and Escape only). */
  allowInInputs?: boolean;
  /** Fires while an overlay is open (the palette toggle). Global shortcuts otherwise stand down. */
  allowInLayers?: boolean;
  /** Handled by a dedicated mechanism rather than useShortcut — listed for the help dialog and the duplicate guard. */
  handledBy?: string;
}

export const SHORTCUTS = {
  "palette.toggle": { keys: "mod+k", display: "Ctrl/⌘ K", description: "Search and jump anywhere", scope: "global", group: "General", allowInInputs: true, allowInLayers: true },
  "search.focus": { keys: "/", display: "/", description: "Search this page (or open search)", scope: "global", group: "General" },
  "create.open": { keys: "c", display: "C", description: "Create…", scope: "global", group: "General" },
  "help.open": { keys: "?", display: "?", description: "Keyboard shortcuts", scope: "global", group: "General" },
  "nav.goTo": { keys: "g *", display: "G then a key", description: "Go to a module (G O orders, G P products, …)", scope: "global", group: "Go to" },
  "list.next": { keys: "j", display: "J", description: "Next row", scope: "list", group: "Lists" },
  "list.prev": { keys: "k", display: "K", description: "Previous row", scope: "list", group: "Lists" },
  "list.open": { keys: "enter", display: "Enter", description: "Open the row", scope: "list", group: "Lists" },
  "list.select": { keys: "x", display: "X", description: "Select / deselect the row", scope: "list", group: "Lists" },
  "list.actions": { keys: ".", display: ".", description: "Row actions", scope: "list", group: "Lists" },
  "drawer.prev": { keys: "arrowup", display: "↑", description: "Previous item in the drawer", scope: "drawer", group: "Drawers", handledBy: "components/ui/drawer.tsx" },
  "drawer.next": { keys: "arrowdown", display: "↓", description: "Next item in the drawer", scope: "drawer", group: "Drawers", handledBy: "components/ui/drawer.tsx" },
  "form.save": { keys: "mod+s", display: "Ctrl/⌘ S", description: "Save", scope: "form", group: "Forms", allowInInputs: true },
  "form.submit": { keys: "mod+enter", display: "Ctrl/⌘ Enter", description: "Submit / confirm", scope: "form", group: "Forms", allowInInputs: true },
  "layer.close": { keys: "escape", display: "Esc", description: "Close the top-most panel or dialog", scope: "layer", group: "General", allowInInputs: true, handledBy: "lib/layer-stack.ts" },
} as const satisfies Record<string, ShortcutDefinition>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** The chord prefix key ("g" of "g *"), if the shortcut is a chord. */
export function chordPrefix(keys: string): string | null {
  const match = /^(\S) \*$/.exec(keys);
  return match ? match[1]! : null;
}
