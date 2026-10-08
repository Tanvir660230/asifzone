"use client";

import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { isCharacterKeyShortcut, useSingleKeyShortcuts } from "@/hooks/use-shortcut";
import { SHORTCUTS, type ShortcutDefinition } from "@/lib/admin/shortcuts";
import { goTargets } from "@/lib/admin/navigation";
import { useNavAccess } from "@/hooks/use-nav-access";
import { cn } from "@/lib/utils";

const GROUPS: ShortcutDefinition["group"][] = ["General", "Go to", "Lists", "Drawers", "Forms"];

/** The `?` dialog — every shortcut in the registry (lib/admin/shortcuts.ts) and the `g` targets from the navigation
 * manifest, so the help can never drift from what the keys actually do. */
export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const access = useNavAccess();
  const all: ShortcutDefinition[] = Object.values(SHORTCUTS);
  const go = goTargets(access);
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Single-key shortcuts pause while you type." widthClassName="max-w-lg">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-xl bg-surface-muted px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">
              Single-key shortcuts
            </p>
            <p className="mt-0.5 text-[13px] text-fg-muted">Shortcuts that are one letter or symbol. Turn off if they fire by accident.</p>
          </div>
          <Switch checked={singleKeys} onChange={setSingleKeys} aria-label="Single-key shortcuts" />
        </div>
        {GROUPS.map((group) => {
          const items = all.filter((s) => s.group === group);
          if (!items.length) return null;
          return (
            <section key={group}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{group}</h3>
              <dl className="space-y-1.5 text-sm">
                {items.map((s) => (
                  <div key={s.keys} className={cn("flex items-center justify-between gap-4", !singleKeys && isCharacterKeyShortcut(s.keys) && "opacity-45")}>
                    <dt className="text-ink-700">{s.description}</dt>
                    <dd>
                      <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-600">{s.display}</kbd>
                    </dd>
                  </div>
                ))}
                {group === "Go to" &&
                  go.map((t) => (
                    <div key={t.key} className={cn("flex items-center justify-between gap-4 pl-3", !singleKeys && "opacity-45")}>
                      <dt className="text-ink-500">{t.node.breadcrumb ?? t.node.label}</dt>
                      <dd>
                        <kbd className="rounded border border-line bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] font-medium uppercase text-ink-600">g {t.key}</kbd>
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
