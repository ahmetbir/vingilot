// Where the terminal splits live between app runs — the small half of the
// pair, exactly as `terminalTabStore.ts` is for the tabs, and for the same
// reason: under tmux a split's second shell survives quitting the app, and
// nothing would know its name on the way back in.
//
// The same storage arrangement too: `localStorage`, injectable so plain
// `node --test` can pass a shim; checked rather than repaired; a shape this
// build does not recognise reads as no splits, never a throw. Not cleared on
// a community switch for the reason the tab layout is not — a split is keyed
// by a session on this machine, and pointing the app at a different relay is
// no reason to forget the owner's shells.

import type { StorageLike } from "./terminalTabStore.ts";
import {
  emptySplits,
  MIN_SPLIT_RATIO,
  type SplitLayout,
  type TabSplit,
} from "./terminalSplit.ts";

/** Versioned like the tab layout's key: a future shape change gets a new key
 * rather than a migration. */
const SPLITS_KEY = "vingilot-terminal-splits.v1";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** True for a value that is a usable split: a named direction and a ratio
 * already inside the clamp. Checked, not repaired — the rule
 * `terminalTabStore.ts` states for a shape this app itself wrote. */
function isTabSplit(value: unknown): value is TabSplit {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.direction !== "right" && v.direction !== "down") return false;
  if (typeof v.ratio !== "number" || !Number.isFinite(v.ratio)) return false;
  return v.ratio >= MIN_SPLIT_RATIO && v.ratio <= 1 - MIN_SPLIT_RATIO;
}

export function parseSplitLayout(raw: string | null): SplitLayout {
  if (raw === null || raw === "") return emptySplits();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySplits();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptySplits();
  }
  const splits: Record<string, TabSplit> = {};
  for (const [primary, value] of Object.entries(parsed)) {
    if (primary === "" || !isTabSplit(value)) continue;
    splits[primary] = { direction: value.direction, ratio: value.ratio };
  }
  return splits;
}

export function readSplitLayout(
  storage: StorageLike = defaultStorage(),
): SplitLayout {
  return parseSplitLayout(storage.getItem(SPLITS_KEY));
}

export function writeSplitLayout(
  splits: SplitLayout,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(SPLITS_KEY, JSON.stringify(splits));
  } catch {
    // Losing the splits is survivable; failing the render that produced them
    // is not.
  }
}
