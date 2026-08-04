// Device-local layout for Deck: unlike the pin *set* (deckPins.ts), the
// arrangement of pinned cards lives only in `localStorage`, keyed by
// workspace **and** a per-device id, so two devices genuinely differ (the
// design's "a laptop cannot scramble a monitor" rule). This file never
// talks to the network — see vingilot/docs/plans/2026-08-04-deck-phase-3.md.
//
// Every storage-touching export takes an optional `storage` param
// defaulting to `globalThis.localStorage` so plain `node --test` (no DOM)
// can inject an in-memory shim instead.

import type { Pin } from "./deckPins.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const DEVICE_ID_KEY = "buzz-deck-device-id.v1";
const LAYOUT_KEY_PREFIX = "buzz-deck-layout.v1";

function defaultStorage(): StorageLike {
  return (globalThis as { localStorage?: StorageLike })
    .localStorage as StorageLike;
}

function randomId(): string {
  const g = globalThis as {
    crypto?: { randomUUID?: () => string };
  };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  // Fallback for environments without crypto.randomUUID — good enough for
  // a device-local, non-cryptographic id.
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** A stable per-device id, created once and persisted in `storage`. Stable
 * across repeated calls against the same storage; independent storages
 * (i.e. different devices/profiles) get independent ids. */
export function deviceId(storage: StorageLike = defaultStorage()): string {
  const existing = storage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = randomId();
  storage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/** The localStorage key layout is scoped under — includes both the
 * workspace id and this device's id, so switching workspaces or devices
 * never leaks another arrangement. */
export function layoutKey(
  workspaceId: string,
  storage: StorageLike = defaultStorage(),
): string {
  return `${LAYOUT_KEY_PREFIX}:${workspaceId}:${deviceId(storage)}`;
}

/** Ordered pin ids for this workspace+device. Missing or corrupt storage
 * reads as an empty layout, never a throw. */
export function readLayout(
  workspaceId: string,
  storage: StorageLike = defaultStorage(),
): string[] {
  const raw = storage.getItem(layoutKey(workspaceId, storage));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id) => typeof id === "string")
    ) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function writeLayout(
  workspaceId: string,
  order: string[],
  storage: StorageLike = defaultStorage(),
): void {
  storage.setItem(layoutKey(workspaceId, storage), JSON.stringify(order));
}

/** Splits `pins` into `placed` (present in `order`, in that order) and
 * `unplaced` (arrived on this device without a placement — e.g. pinned
 * elsewhere), appended in `pinnedAt` order so newer arrivals sort last. */
export function applyLayout(
  pins: Pin[],
  order: string[],
): { placed: Pin[]; unplaced: Pin[] } {
  const byId = new Map(pins.map((p) => [p.id, p]));
  const placedIds = new Set<string>();
  const placed: Pin[] = [];
  for (const id of order) {
    const p = byId.get(id);
    if (p && !placedIds.has(id)) {
      placed.push(p);
      placedIds.add(id);
    }
  }
  const unplaced = pins
    .filter((p) => !placedIds.has(p.id))
    .sort((a, b) => a.pinnedAt.localeCompare(b.pinnedAt));
  return { placed, unplaced };
}

/** Moves `id` one position in `dir` (-1 left, +1 right) within `order`.
 * A no-op (new array, same contents) at either boundary or when `id` is
 * absent from `order`. */
export function moveInLayout(
  order: string[],
  id: string,
  dir: -1 | 1,
): string[] {
  const index = order.indexOf(id);
  if (index === -1) return [...order];
  const target = index + dir;
  if (target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
