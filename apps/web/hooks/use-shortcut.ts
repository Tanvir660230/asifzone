"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { chordPrefix, SHORTCUTS, type ShortcutDefinition, type ShortcutId } from "@/lib/admin/shortcuts";
import { comboOf, isTypingTarget } from "@/lib/keyboard";
import { hasOpenLayer } from "@/lib/layer-stack";

/**
 * Bind behaviour to a registered shortcut (lib/admin/shortcuts.ts): `useShortcut("create.open", () => setOpen(true))`.
 * One document listener serves every binding. Single-key shortcuts never fire while typing; global ones stand down while
 * an overlay is open (Escape belongs to the layer stack). For a chord (`"g *"`) the handler receives the second key.
 *
 * Two live bindings of the same global shortcut are a bug (two components fighting over one key): reported in
 * development and thrown in tests. In `list` / `drawer` / `form` scope the most recent binding wins — bind those only
 * while the owner is focused or open (`enabled`).
 */
type Handler = (event: KeyboardEvent, chordKey?: string) => void;

interface Binding {
  token: number;
  handler: MutableRefObject<Handler>;
}

const bindings = new Map<ShortcutId, Binding[]>();
let nextToken = 1;
let installed = false;
let pendingChord: { prefix: string; at: number } | null = null;
const CHORD_TIMEOUT_MS = 1500;

function definition(id: ShortcutId): ShortcutDefinition {
  return SHORTCUTS[id];
}

function dispatch(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return;
  const typing = isTypingTarget(event.target);
  const layered = hasOpenLayer();
  const combo = comboOf(event);

  if (pendingChord) {
    const chord = pendingChord;
    pendingChord = null;
    if (Date.now() - chord.at <= CHORD_TIMEOUT_MS && !typing && /^[a-z0-9]$/.test(combo)) {
      for (const [id, list] of bindings) {
        if (list.length && chordPrefix(definition(id).keys) === chord.prefix) {
          event.preventDefault();
          list.at(-1)!.handler.current(event, combo);
          return;
        }
      }
    }
  }

  for (const [id, list] of bindings) {
    if (!list.length) continue;
    const def = definition(id);
    if (def.handledBy) continue;
    if (typing && !def.allowInInputs) continue;
    if (layered && def.scope === "global" && !def.allowInLayers) continue;
    const prefix = chordPrefix(def.keys);
    if (prefix) {
      if (combo === prefix) pendingChord = { prefix, at: Date.now() };
      continue;
    }
    if (def.keys === combo) {
      event.preventDefault();
      list.at(-1)!.handler.current(event);
      return;
    }
  }
}

function bind(id: ShortcutId, handler: MutableRefObject<Handler>): () => void {
  if (!installed && typeof document !== "undefined") {
    document.addEventListener("keydown", dispatch);
    installed = true;
  }
  const list = bindings.get(id) ?? [];
  if (list.length && definition(id).scope === "global") {
    const message = `[shortcuts] "${id}" (${definition(id).keys}) is already bound — two components claim the same global shortcut`;
    if (process.env.NODE_ENV === "test") throw new Error(message);
    if (process.env.NODE_ENV !== "production") console.error(message);
  }
  const binding = { token: nextToken++, handler };
  bindings.set(id, [...list, binding]);
  return () => bindings.set(id, (bindings.get(id) ?? []).filter((b) => b.token !== binding.token));
}

export function useShortcut(id: ShortcutId, handler: Handler, { enabled = true }: { enabled?: boolean } = {}) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return bind(id, ref);
  }, [id, enabled]);
}

/** Test-only: drop every binding and any pending chord. */
export function resetShortcutsForTests() {
  bindings.clear();
  pendingChord = null;
}

/** Test-only access to the dispatcher (the hook installs it on the document in the browser). */
export const __dispatchForTests = dispatch;
export const __bindForTests = bind;
