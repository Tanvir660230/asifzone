"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomepageSectionType, StorefrontDesign, StorefrontDesignGroup, StudioSection } from "@clothing-brand/shared";
import { ApiError } from "@/lib/api-client";
import * as studioApi from "@/lib/api/admin-homepage-studio";

const HISTORY_LIMIT = 50;
const AUTOSAVE_MS = 800;
/** Keystrokes in one field within this window are one undo step. */
const COALESCE_MS = 1000;

export type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";
export type PublishResult = { ok: true } | { ok: false; errors: Record<string, string[]>; message: string };

/** What the Studio edits: the homepage's sections and the site design, saved, undone and published together. */
interface StudioDoc {
  sections: StudioSection[];
  design: StorefrontDesign;
}

function newId() {
  return `new-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

/** JSON with object keys sorted — Postgres JSONB hands keys back in its own order, so plain JSON.stringify would call
 * identical content different. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * The Storefront Studio's editing state: the draft (sections + site design), the selection, undo/redo, autosave (800 ms
 * after the last change, against the server's draft version — a 409 stops autosaving and reports a conflict), publish,
 * discard and restore. Publishing first flushes any unsaved edit.
 */
export function useStudioDraft() {
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [doc, setDoc] = useState<StudioDoc>({ sections: [], design: {} });
  const [live, setLive] = useState<StudioDoc>({ sections: [], design: {} });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Undo/redo stacks live in refs (no side effects inside state updaters); `historyTick` re-renders the buttons.
  const pastRef = useRef<StudioDoc[]>([]);
  const futureRef = useRef<StudioDoc[]>([]);
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((n) => n + 1);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [publishing, setPublishing] = useState(false);

  const versionRef = useRef(0);
  const savedRef = useRef<StudioDoc>({ sections: [], design: {} });
  const docRef = useRef<StudioDoc>(doc);
  docRef.current = doc;
  const lastEditRef = useRef<{ key: string; at: number } | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const conflictRef = useRef(false);

  const apply = useCallback((state: studioApi.StudioState) => {
    const next = { sections: state.sections, design: (state.design ?? {}) as StorefrontDesign };
    versionRef.current = state.version;
    savedRef.current = next;
    conflictRef.current = false;
    setDoc(next);
    setLive({ sections: state.liveSections, design: (state.liveDesign ?? {}) as StorefrontDesign });
    setSavedAt(state.updatedAt ? new Date(state.updatedAt) : null);
    setSaveState(state.hasDraft ? "saved" : "idle");
    pastRef.current = [];
    futureRef.current = [];
    bumpHistory();
    lastEditRef.current = null;
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      apply(await studioApi.getStudio());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every edit goes through here: one undo step, unless it continues the same field's typing (`coalesceKey`). */
  const commit = useCallback((next: StudioDoc, coalesceKey?: string) => {
    const now = Date.now();
    const last = lastEditRef.current;
    const continues = coalesceKey && last && last.key === coalesceKey && now - last.at < COALESCE_MS;
    if (!continues) pastRef.current = [...pastRef.current, docRef.current].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    bumpHistory();
    lastEditRef.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    setDoc(next);
  }, []);

  const commitSections = useCallback(
    (sections: StudioSection[], coalesceKey?: string) => commit({ ...docRef.current, sections }, coalesceKey),
    [commit],
  );

  const save = useCallback(async () => {
    if (conflictRef.current) return;
    // One save at a time; a change made during a save is saved right after it.
    while (savingRef.current) await savingRef.current;
    const sending = docRef.current;
    if (same(sending, savedRef.current)) return;
    setSaveState("saving");
    const run = (async () => {
      try {
        const res = await studioApi.saveStudioDraft(versionRef.current, sending.sections, sending.design);
        versionRef.current = res.version;
        savedRef.current = sending;
        setSavedAt(new Date(res.updatedAt));
        setSaveState(same(docRef.current, sending) ? "saved" : "saving");
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          conflictRef.current = true;
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, []);

  // Autosave shortly after the admin stops changing things.
  useEffect(() => {
    if (status !== "ready" || same(doc, savedRef.current)) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc, status, save]);

  // Don't let the admin close the tab on an edit that hasn't reached the server.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!same(docRef.current, savedRef.current) && !conflictRef.current) e.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const update = useCallback(
    (id: string, patch: Partial<StudioSection>, coalesceKey?: string) => {
      commitSections(docRef.current.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)), coalesceKey);
    },
    [commitSections],
  );

  const updateConfig = useCallback(
    (id: string, config: Record<string, unknown>, coalesceKey?: string) => update(id, { config }, coalesceKey ? `${id}:${coalesceKey}` : undefined),
    [update],
  );

  /** One group of the site design (theme, announcement, header, footer); an empty group is removed. */
  const updateDesign = useCallback(
    (group: StorefrontDesignGroup, value: Record<string, unknown>, coalesceKey?: string) => {
      const design = { ...docRef.current.design } as Record<string, unknown>;
      if (Object.keys(value).length === 0) delete design[group];
      else design[group] = value;
      commit({ ...docRef.current, design: design as StorefrontDesign }, coalesceKey ? `design:${group}:${coalesceKey}` : undefined);
    },
    [commit],
  );

  const add = useCallback(
    (type: HomepageSectionType, config: Record<string, unknown>) => {
      const section: StudioSection = { id: newId(), type, isActive: true, config, startsAt: null, endsAt: null };
      const list = docRef.current.sections;
      // Right after the selected section, else at the end.
      const selected = list.findIndex((s) => s.id === selectedId);
      const at = selected >= 0 ? selected + 1 : list.length;
      commitSections([...list.slice(0, at), section, ...list.slice(at)]);
      setSelectedId(section.id);
      return section.id;
    },
    [commitSections, selectedId],
  );

  const duplicate = useCallback(
    (id: string) => {
      const list = docRef.current.sections;
      const at = list.findIndex((s) => s.id === id);
      if (at < 0) return;
      const copy = { ...structuredClone(list[at]!), id: newId() };
      commitSections([...list.slice(0, at + 1), copy, ...list.slice(at + 1)]);
      setSelectedId(copy.id);
    },
    [commitSections],
  );

  const remove = useCallback(
    (id: string) => {
      const list = docRef.current.sections;
      const at = list.findIndex((s) => s.id === id);
      commitSections(list.filter((s) => s.id !== id));
      if (selectedId === id) setSelectedId(list[at + 1]?.id ?? list[at - 1]?.id ?? null);
    },
    [commitSections, selectedId],
  );

  const move = useCallback(
    (from: number, to: number) => {
      const list = [...docRef.current.sections];
      if (from === to || to < 0 || to >= list.length) return;
      const [item] = list.splice(from, 1);
      list.splice(to, 0, item!);
      commitSections(list);
    },
    [commitSections],
  );

  const undo = useCallback(() => {
    const prev = pastRef.current.at(-1);
    if (!prev) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [docRef.current, ...futureRef.current];
    lastEditRef.current = null;
    setDoc(prev);
    bumpHistory();
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    futureRef.current = futureRef.current.slice(1);
    pastRef.current = [...pastRef.current, docRef.current].slice(-HISTORY_LIMIT);
    lastEditRef.current = null;
    setDoc(next);
    bumpHistory();
  }, []);

  const publish = useCallback(async (): Promise<PublishResult> => {
    setPublishing(true);
    try {
      await save();
      if (conflictRef.current) return { ok: false, errors: {}, message: "The draft was changed somewhere else — reload first." };
      // Never publish an older draft than the one on screen: the latest edit has to have reached the server.
      if (!same(docRef.current, savedRef.current)) {
        return { ok: false, errors: {}, message: "Your latest changes couldn't be saved — check your connection and try again." };
      }
      const selectedIndex = docRef.current.sections.findIndex((s) => s.id === selectedId);
      await studioApi.publishStudioDraft(versionRef.current);
      const state = await studioApi.getStudio();
      apply(state);
      // Newly added sections got their real ids on publish: keep the same section selected.
      if (selectedIndex >= 0) setSelectedId(state.sections[selectedIndex]?.id ?? null);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.details && typeof err.details === "object") {
        return { ok: false, errors: err.details as Record<string, string[]>, message: err.message };
      }
      if (err instanceof ApiError && err.status === 409) {
        conflictRef.current = true;
        setSaveState("conflict");
      }
      return { ok: false, errors: {}, message: err instanceof Error ? err.message : "Couldn't publish" };
    } finally {
      setPublishing(false);
    }
  }, [apply, save, selectedId]);

  const discard = useCallback(async () => {
    await studioApi.discardStudioDraft();
    await load();
  }, [load]);

  const restore = useCallback(
    async (revisionId: string) => {
      apply(await studioApi.restoreStudioRevision(revisionId));
      setSaveState("saved");
    },
    [apply],
  );

  const hasUnpublishedChanges = useMemo(() => !same(doc, live), [doc, live]);

  return {
    status,
    reload: load,
    sections: doc.sections,
    design: doc.design,
    liveSections: live.sections,
    selectedId,
    select: setSelectedId,
    update,
    updateConfig,
    updateDesign,
    add,
    duplicate,
    remove,
    move,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    saveState,
    savedAt,
    hasUnpublishedChanges,
    publishing,
    publish,
    discard,
    restore,
  };
}

export type StudioDraft = ReturnType<typeof useStudioDraft>;
