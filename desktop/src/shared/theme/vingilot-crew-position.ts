/**
 * Vingilot redesign P1 — the Crew panel position preference.
 *
 * The Appearance tray's "Crew panel" segmented control (Right / Drawer /
 * Float) persists here, in the same localStorage-key-per-concern idiom as
 * `vingilot-appearance.ts`. P1 only *stores* the choice — the dock that reads
 * it lands with P3, and the tray says so next to the control. Kept as its own
 * shy module so P3 imports a vocabulary, not a tray.
 */

import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";

export const VINGILOT_CREW_POSITION_STORAGE_KEY = "vingilot-crew-position";

export const VINGILOT_CREW_POSITIONS = ["right", "drawer", "float"] as const;
export type VingilotCrewPosition = (typeof VINGILOT_CREW_POSITIONS)[number];

export const DEFAULT_VINGILOT_CREW_POSITION: VingilotCrewPosition = "right";

function isVingilotCrewPosition(value: string): value is VingilotCrewPosition {
  return (VINGILOT_CREW_POSITIONS as readonly string[]).includes(value);
}

/** Read the stored position, falling back to the mockup's default (right). */
export function readVingilotCrewPosition(): VingilotCrewPosition {
  const stored = getStorageItem(VINGILOT_CREW_POSITION_STORAGE_KEY);
  return stored !== null && isVingilotCrewPosition(stored)
    ? stored
    : DEFAULT_VINGILOT_CREW_POSITION;
}

/** Persist the choice; best-effort (throw-safe) like every sibling key. */
export function persistVingilotCrewPosition(position: VingilotCrewPosition) {
  setStorageItem(VINGILOT_CREW_POSITION_STORAGE_KEY, position);
}
