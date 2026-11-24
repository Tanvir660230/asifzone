/** A text link in the glass header (header.tsx): ink, a soft pill under the pointer, 40px tall. */
export const TAHAFI_NAV_LINK =
  "inline-flex h-10 items-center rounded-full px-3.5 text-[0.9375rem] font-medium text-fg transition-colors duration-200 ease-smooth hover:bg-ink-900/[0.06] focus-visible:outline-offset-2";

/** A round button floating over content (header actions on phones): the glass panel's edge and depth on an opaque fill
 * (globals.css .solid-panel) — a live blur under buttons that sit over the page all the time made scrolling stutter on
 * mid-range phones. */
export const TAHAFI_GLASS_BUTTON =
  "solid-panel flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-fg transition-transform duration-200 ease-smooth active:scale-95";

/** A white card with soft depth: the promise line, category chips, the menu's help links. */
export const TAHAFI_CARD = "rounded-[1.375rem] bg-surface shadow-[var(--panel-shadow)]";

/** A dark plate on a photograph (a caption, a label): white type stays readable on any picture. Darker than it was and
 * without a blur: captions blurring the photographs under them while a rail scrolls were the heaviest paint on the page. */
export const TAHAFI_PHOTO_GLASS = "border border-white/20 bg-black/45 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]";
