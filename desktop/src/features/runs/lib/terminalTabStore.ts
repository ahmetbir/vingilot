// Where a worktree's terminal tabs live between app runs.
//
// The tmux sessions themselves already survive quitting the app (`tmux.rs`),
// but nothing knew their *names* on the way back in: a session id is derived
// from a worktree binding id and a tab ordinal, and the ordinals only ever
// existed in React state. Reopening the app would attach one tab per worktree
// and leave the owner's other shells running, nameless, until the tmux server
// died. So the layout is written here — the small half of the pair, the half
// that is data.
//
// **Restoring a tab is not a claim that its shell is still there.** All that
// comes back is a session id. Whether that id has a live pty, a detached tmux
// session, or nothing at all is decided at open time and by nobody here:
// `pty_open` spawns when no session is registered, and the spawn runs
// `tmux new-session -A`, which attaches to that name if it exists and creates
// it if it does not. A tab whose tmux session was ended by a reboot therefore
// comes back as a fresh shell in the right worktree — the normal path, not an
// error path, which is why there is no liveness check to write here.
//
// **Tab names ride in the same record, and the key stays `.v1`** (P4.5).
// `names` is additive: an older build reading a newer layout copies the three
// fields it knows and drops the names, which costs labels rather than tabs, and
// a newer build reading an older layout finds no names and draws ordinals —
// which is what every tab drew before. A version bump would have been the
// alternative, and it would have thrown away the owner's real tab strips to
// protect a label.
//
// Storage is `localStorage`, injectable so plain `node --test` (no DOM) can
// pass an in-memory shim — the same arrangement `deckLayout.ts` uses.
// Deliberately not cleared on a community switch, unlike the singletons in
// `resetCommunityState()` (CLAUDE.md, "Community Switching"): those hold
// relay-scoped data, while a terminal tab is keyed by a worktree on this
// machine and pointing the app at a different relay is no reason to forget the
// owner's shells.

import { normalizeStripName } from "./stripName.ts";
import {
  emptyLayout,
  type TabLayout,
  type WorktreeTabs,
} from "./terminalTabs.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned: a future shape change gets a new key rather than a migration,
 * so an older build reading a newer layout finds nothing and starts clean
 * instead of finding something it half-understands. */
const LAYOUT_KEY = "vingilot-terminal-tabs.v1";

/** Storage that answers nothing and keeps nothing, for contexts with no
 * `localStorage` (a `node --test` run, a stripped webview). Losing the layout
 * is survivable; throwing on the way into the Projects screen is not. */
const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** True for a value that is a usable strip: a non-empty run of distinct
 * positive integer ordinals, an active tab that is one of them, and a next
 * ordinal above every tab in the strip.
 *
 * Checked rather than repaired. A layout is written by this app and read back
 * by this app, so a value failing any of these is corrupt or hand-edited
 * storage, and the safe reading of "the shape I do not recognise" is to open a
 * fresh tab — which loses a tab strip — rather than to invent an `active` that
 * addresses a tab that is not there, or an ordinal that hands a new tab an old
 * tab's session. */
function isWorktreeTabs(value: unknown): value is WorktreeTabs {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.tabs) || v.tabs.length === 0) return false;
  if (!v.tabs.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    return false;
  }
  const tabs = v.tabs as number[];
  if (new Set(tabs).size !== tabs.length) return false;
  if (typeof v.active !== "number" || !tabs.includes(v.active)) return false;
  if (!Number.isInteger(v.nextN)) return false;
  return (v.nextN as number) > Math.max(...tabs);
}

/** The tab names that survive a read (P4.5), or `null` for a strip that has
 * none worth keeping.
 *
 * **Checked, and repaired rather than refused** — the one place this file
 * departs from the rule above it, and the difference is what is at stake. A
 * bad `active` could point a tab at another shell's session; a bad NAME is a
 * label. So a malformed entry costs its label and nothing else, and a strip is
 * never thrown away over one. Names for ordinals the strip no longer holds are
 * dropped for the same reason `closeTab` drops them: they can never be shown
 * again, and kept they would only accumulate. */
function readTabNames(
  value: unknown,
  tabs: readonly number[],
): Readonly<Record<string, string>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const live = new Set(tabs.map(String));
  const names: Record<string, string> = {};
  for (const [key, name] of Object.entries(value)) {
    if (!live.has(key) || typeof name !== "string") continue;
    const clean = normalizeStripName(name);
    if (clean !== "") names[key] = clean;
  }
  return Object.keys(names).length === 0 ? null : names;
}

/** Read a stored layout, dropping any worktree whose strip does not survive
 * `isWorktreeTabs`. Missing, unparseable, or wrongly-shaped storage reads as
 * an empty layout — never a throw, because this is called during the render
 * that puts the Projects screen on screen. */
export function parseTabLayout(raw: string | null): TabLayout {
  if (raw === null || raw === "") return emptyLayout();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyLayout();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return emptyLayout();
  }
  const layout: Record<string, WorktreeTabs> = {};
  for (const [bindingId, value] of Object.entries(parsed)) {
    if (bindingId === "" || !isWorktreeTabs(value)) continue;
    const strip: WorktreeTabs = {
      active: value.active,
      nextN: value.nextN,
      tabs: [...value.tabs],
    };
    const names = readTabNames(value.names, strip.tabs);
    layout[bindingId] = names === null ? strip : { ...strip, names };
  }
  return layout;
}

export function readTabLayout(
  storage: StorageLike = defaultStorage(),
): TabLayout {
  return parseTabLayout(storage.getItem(LAYOUT_KEY));
}

/** Mirror the whole layout back to storage. The layout is the unit of change,
 * as it is in memory, so there is no partial write to reconcile against. A
 * storage that refuses the write (quota, a private-mode webview) costs the
 * next restart its tab strips and nothing else. */
export function writeTabLayout(
  layout: TabLayout,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Losing the layout is survivable; failing the render that produced it
    // is not.
  }
}
