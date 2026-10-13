import type { StorefrontDesign, StudioSection } from "@clothing-brand/shared";

/** The Storefront Studio's preview: the real homepage rendered in a same-origin iframe from the unsaved draft. */
export const STUDIO_FRAME_PATH = "/admin/homepage-preview-frame";

export type StudioDevice = "desktop" | "tablet" | "mobile";

/** Real viewport widths — the frame renders at this width so the storefront's own breakpoints respond exactly as on that
 * device, and the canvas then scales the frame to fit. Mobile is the 375px floor every page must work at. */
export const STUDIO_DEVICE_WIDTH: Record<StudioDevice, number> = { desktop: 1280, tablet: 834, mobile: 375 };

/** Studio → frame: the draft as it is now, and which section the inspector has open. */
export interface StudioUpdateMessage {
  type: "studio:update";
  sections: StudioSection[];
  /** The draft site design: theme tokens, announcement bar, header and footer. */
  design: StorefrontDesign;
  selectedId: string | null;
}

/** Studio → frame: bring a section into view (picked in the outline). */
export interface StudioScrollToMessage {
  type: "studio:scroll-to";
  id: string;
}

/** Frame → Studio: the listener is attached; send the current state. */
export interface StudioReadyMessage {
  type: "studio:ready";
}

/** Frame → Studio: the admin clicked a section in the preview. */
export interface StudioSelectMessage {
  type: "studio:select";
  id: string;
}

/** Frame → Studio: switched-on sections that take no space at this width — hidden on this device, or with nothing to
 * show yet (no reviews, no running flash sale …), so the outline can say so. */
export interface StudioRenderedMessage {
  type: "studio:rendered";
  emptyIds: string[];
}

export type StudioToFrameMessage = StudioUpdateMessage | StudioScrollToMessage;
export type FrameToStudioMessage = StudioReadyMessage | StudioSelectMessage | StudioRenderedMessage;

export function isStudioMessage<T extends { type: string }>(data: unknown, type: T["type"]): data is T {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === type;
}
