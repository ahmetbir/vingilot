// The worktrees he pinned, in the order he pinned them (2026-09-04, his
// brief: "⌘1–5: pinned worktree'lere doğrudan geç ... Ziyaret edilen her
// worktree otomatik tab olmamalı").
//
// **A pin is a digit that stays put.** The nav's order — and so ⌘1…9 — ranks
// by attention, which is right for reading and wrong for muscle memory: a
// worktree that turns dirty moves, and the digit he learned moves with it.
// Pinned worktrees sit right after the project's own checkout, in pin
// order, whatever their state (`orderWorktrees`), so ⌘2 is the same worktree
// tomorrow. Everything that reads the one order — the nav, the ⌘-digits, the
// switcher, ⌘K — follows without a second list.
//
// **Per machine, not per workspace.** The same arrangement as `diffMode.ts`:
// a module singleton, a listener set, `localStorage` as a best-effort mirror,
// a versioned key, not community-scoped and so deliberately absent from
// `resetCommunityState()`. Which worktrees his fingers know is a fact about
// this keyboard, not about a relay.

import * as React from "react";

const KEY = "vingilot-pinned-worktrees.v1";
const listeners = new Set<() => void>();

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
}

/** Tolerant read: anything but an array of distinct non-empty strings is no
 * pins, never a throw over the nav. */
export function parsePinned(raw: string | null | undefined): readonly string[] {
  if (raw === null || raw === undefined || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of parsed) {
      if (typeof id !== "string" || id === "" || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

/** The list after pressing the pin on `id`: off if it was on, else appended
 * — pin order is the order he pinned in, which is the digit order. */
export function togglePinned(
  pinned: readonly string[],
  id: string,
): readonly string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
}

function readStored(): readonly string[] {
  try {
    return parsePinned(storage()?.getItem(KEY));
  } catch {
    return [];
  }
}

let pinned: readonly string[] = readStored();

export function getPinned(): readonly string[] {
  return pinned;
}

export function isPinned(id: string): boolean {
  return pinned.includes(id);
}

export function togglePin(id: string): void {
  pinned = togglePinned(pinned, id);
  try {
    storage()?.setItem(KEY, JSON.stringify(pinned));
  } catch {
    // A pin that did not persist is a pin for this session; the digit still
    // moves now.
  }
  for (const listener of listeners) listener();
}

export function subscribePinned(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The pins, live: any component that draws a digit or a pin glyph reads
 * them here and re-renders when one is pressed anywhere. */
export function usePinnedWorktrees(): readonly string[] {
  return React.useSyncExternalStore(subscribePinned, getPinned, getPinned);
}

export function resetPinnedForTests(): void {
  pinned = [];
}
