// Where a worktree's pane arrangement lives between app runs.
//
// The tab layout next door (`terminalTabStore.ts`) is strict about what it
// reads back, because a half-understood strip could hand a new tab an old
// tab's shell. Nothing here can do that: the worst a wrong value costs is a
// pane on the wrong side of a divider. So this module coerces rather than
// rejecting — an out-of-range ratio is clamped, an unknown pane id falls back
// to the default, and a key whose value is not an object is dropped — because
// the alternative is an owner whose arrangement quietly resets and who has no
// way to find out why.
//
// Storage is `localStorage`, injectable so plain `node --test` (no DOM) can
// pass an in-memory shim — the same arrangement `terminalTabStore.ts` and
// `columnLayout.ts` use. Deliberately not cleared on a community switch: a
// pane layout is keyed by a worktree on this machine, and pointing the app at
// a different relay is no reason to forget how the owner arranged his screen.

import {
  clampRatio,
  DEFAULT_RATIO,
  defaultPaneState,
  PANE_IDS,
  type PaneId,
  type PaneLayout,
  type PaneState,
} from "./paneModel.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned: a future shape change gets a new key rather than a migration, so
 * an older build reading a newer layout finds nothing and starts from the
 * defaults instead of from something it half-understands. */
const LAYOUT_KEY = "vingilot-panes.v1";

/** Storage that answers nothing and keeps nothing, for contexts with no
 * `localStorage` (a `node --test` run, a stripped webview). Losing the layout
 * costs one restart's worth of arrangement; throwing on the way into the
 * workspace screen costs the screen. */
const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

function readPaneId(value: unknown, fallback: PaneId): PaneId {
  return PANE_IDS.find((id) => id === value) ?? fallback;
}

function readState(value: unknown): PaneState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const fallback = defaultPaneState();
  return {
    collapsed: record.collapsed === true,
    ratio:
      typeof record.ratio === "number"
        ? clampRatio(record.ratio)
        : DEFAULT_RATIO,
    right: readPaneId(record.right, fallback.right),
  };
}

/** Read a stored layout. Missing, unparseable, or wrongly-shaped storage reads
 * as an empty layout — never a throw, because this is called during the render
 * that puts the workspace screen on screen. */
export function parsePaneLayout(raw: string | null): PaneLayout {
  if (raw === null || raw === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const layout: PaneLayout = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "") continue;
    const state = readState(value);
    if (state !== null) layout[key] = state;
  }
  return layout;
}

export function readPaneLayout(
  storage: StorageLike = defaultStorage(),
): PaneLayout {
  return parsePaneLayout(storage.getItem(LAYOUT_KEY));
}

/** Mirror the whole layout back to storage. A storage that refuses the write
 * (quota, a private-mode webview) costs the next restart its arrangement and
 * nothing else. */
export function writePaneLayout(
  layout: PaneLayout,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Losing the layout is survivable; failing the render that produced it
    // is not.
  }
}
