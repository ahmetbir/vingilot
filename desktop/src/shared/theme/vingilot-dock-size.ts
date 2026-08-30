/**
 * Vingilot redesign P3 — the dock's remembered size.
 *
 * The mockup persists `--dockw` (right card, 300-540) and `--dockh` (drawer,
 * 170-480) globally in its one localStorage blob (vingilot.js:83-85); this
 * module is that memory in the app's localStorage-key-per-concern idiom,
 * beside `vingilot-crew-position.ts` — which holds WHERE the dock is, while
 * this holds HOW BIG. Stored raw and clamped by the reader
 * (`dockModel.ts`'s clamps), so a stale or hand-edited value cannot draw an
 * illegal card.
 */

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";

export const VINGILOT_DOCK_WIDTH_STORAGE_KEY = "vingilot-dock-width";
export const VINGILOT_DOCK_HEIGHT_STORAGE_KEY = "vingilot-dock-height";

function readPx(key: string, fallback: number): number {
  const stored = getStorageItem(key);
  if (stored === null) return fallback;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The stored right-card width, or `fallback` (the mockup's 376). */
export function readVingilotDockWidth(fallback: number): number {
  return readPx(VINGILOT_DOCK_WIDTH_STORAGE_KEY, fallback);
}

export function persistVingilotDockWidth(px: number) {
  setStorageItem(VINGILOT_DOCK_WIDTH_STORAGE_KEY, String(Math.round(px)));
}

/** The stored drawer height, or `fallback` (the mockup's 280). */
export function readVingilotDockHeight(fallback: number): number {
  return readPx(VINGILOT_DOCK_HEIGHT_STORAGE_KEY, fallback);
}

export function persistVingilotDockHeight(px: number) {
  setStorageItem(VINGILOT_DOCK_HEIGHT_STORAGE_KEY, String(Math.round(px)));
}
