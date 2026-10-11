import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUTS, type ShortcutId } from "@/lib/admin/shortcuts";
import { __bindForTests, __dispatchForTests, resetShortcutsForTests } from "@/hooks/use-shortcut";
import { hasOpenLayer, isTopLayer, pushLayer, resetLayerStackForTests } from "@/lib/layer-stack";

// P1.9 / P1.14 — one shortcut registry, no duplicate claims, typing targets and overlays respected; Escape is the
// layer stack's alone.

function key(k: string, init: Partial<Omit<KeyboardEvent, "target">> & { target?: { tagName: string } } = {}) {
  return {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: { tagName: "BODY" },
    preventDefault() {
      (this as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    ...init,
  } as unknown as KeyboardEvent;
}

const bind = (id: ShortcutId, fn: (e: KeyboardEvent, chord?: string) => void) => __bindForTests(id, { current: fn });

afterEach(() => {
  resetShortcutsForTests();
  resetLayerStackForTests();
});

describe("shortcut registry", () => {
  it("never lets two shortcuts claim the same keys in the same scope, and global keys are unique everywhere", () => {
    const entries = Object.entries(SHORTCUTS);
    const clashes = entries.flatMap(([a, da], i) =>
      entries.slice(i + 1).flatMap(([b, db]) => (da.keys === db.keys && (da.scope === db.scope || da.scope === "global" || db.scope === "global") ? [`${a} ↔ ${b}`] : [])),
    );
    expect(clashes).toEqual([]);
  });

  it("reserves the agreed keys and not [ / ]", () => {
    const keys = Object.values(SHORTCUTS).map((s) => s.keys);
    for (const k of ["mod+k", "/", "g *", "c", "j", "k", "enter", "x", ".", "arrowup", "arrowdown", "mod+s", "mod+enter", "escape", "?"]) expect(keys).toContain(k);
    expect(keys).not.toContain("[");
    expect(keys).not.toContain("]");
  });

  it("lets only modifier combos and Escape fire inside text fields", () => {
    for (const [id, s] of Object.entries(SHORTCUTS)) {
      if ("allowInInputs" in s && s.allowInInputs) expect(s.keys === "escape" || s.keys.startsWith("mod+"), id).toBe(true);
    }
  });
});

describe("shortcut dispatcher", () => {
  it("fires a bound shortcut, but not while typing", () => {
    const create = vi.fn();
    bind("create.open", create);
    __dispatchForTests(key("c", { target: { tagName: "INPUT" } }));
    expect(create).not.toHaveBeenCalled();
    __dispatchForTests(key("c"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("modifier shortcuts work in text fields", () => {
    const palette = vi.fn();
    bind("palette.toggle", palette);
    __dispatchForTests(key("k", { ctrlKey: true, target: { tagName: "TEXTAREA" } }));
    __dispatchForTests(key("K", { metaKey: true }));
    expect(palette).toHaveBeenCalledTimes(2);
  });

  it("with single-key shortcuts turned off, only modifier combos fire (WCAG 2.1.4)", () => {
    vi.stubGlobal("localStorage", { getItem: () => "off", setItem() {}, removeItem() {} });
    try {
      const create = vi.fn();
      const palette = vi.fn();
      const go = vi.fn();
      bind("create.open", create);
      bind("palette.toggle", palette);
      bind("nav.goTo", go);
      __dispatchForTests(key("c"));
      __dispatchForTests(key("g"));
      __dispatchForTests(key("o"));
      __dispatchForTests(key("k", { ctrlKey: true }));
      expect(create).not.toHaveBeenCalled();
      expect(go).not.toHaveBeenCalled();
      expect(palette).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("routes a g-chord's second key to the go-to handler", () => {
    const go = vi.fn();
    bind("nav.goTo", go);
    __dispatchForTests(key("g"));
    __dispatchForTests(key("o"));
    expect(go).toHaveBeenCalledWith(expect.anything(), "o");
    __dispatchForTests(key("o")); // no pending chord any more
    expect(go).toHaveBeenCalledTimes(1);
  });

  it("global shortcuts stand down while an overlay is open; the palette toggle doesn't", () => {
    const create = vi.fn();
    const palette = vi.fn();
    bind("create.open", create);
    bind("palette.toggle", palette);
    const layer = pushLayer(() => {});
    __dispatchForTests(key("c"));
    __dispatchForTests(key("k", { ctrlKey: true }));
    expect(create).not.toHaveBeenCalled();
    expect(palette).toHaveBeenCalledTimes(1);
    layer.pop();
    __dispatchForTests(key("c"));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a second live binding of the same global shortcut", () => {
    bind("help.open", () => {});
    expect(() => bind("help.open", () => {})).toThrow(/already bound/);
  });

  it("in list scope the latest binding wins", () => {
    const first = vi.fn();
    const second = vi.fn();
    bind("list.next", first);
    const unbind = bind("list.next", second);
    __dispatchForTests(key("j"));
    expect(second).toHaveBeenCalledTimes(1);
    unbind();
    __dispatchForTests(key("j"));
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe("layer stack", () => {
  it("tracks the top-most layer; popping a lower layer keeps the top", () => {
    const drawer = pushLayer(() => {});
    const popover = pushLayer(() => {});
    expect(isTopLayer(popover.id)).toBe(true);
    expect(isTopLayer(drawer.id)).toBe(false);
    popover.pop();
    expect(isTopLayer(drawer.id)).toBe(true);
    drawer.pop();
    expect(hasOpenLayer()).toBe(false);
  });
});
