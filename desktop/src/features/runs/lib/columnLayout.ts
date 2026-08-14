// Which of the workspace's chrome is collapsed, per project.
//
// Per project, not per app: the owner works in one project with the chrome
// out of the way and in another with the sidebar open, and coming back to
// either should look like how he left it
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 6). The
// project-less landing view is a key like any other, `LANDING_KEY`.
//
// **The `nav` flag is retired and its stored values are discarded, not
// migrated** (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2). The
// workspace nav lives inside the app sidebar now, so there is no second
// column for a flag to hide; a stored `nav: true` from an older build reads
// as nothing here, and the nav starts expanded — the same safe direction the
// v1→v2 discard below chose. The storage key stays `.v2` on purpose: the
// record's shape only narrowed, so an older build reading a newer layout
// finds a well-formed record whose `nav` is absent (expanded — safe), and a
// newer build reading an older one keeps the `sidebar` preference the owner
// actually still has.
//
// The sidebar's collapsed flag is recorded here even though upstream's
// `SidebarProvider` owns the live state: that provider writes a
// `sidebar_state` cookie nothing in this SPA ever reads back, so upstream's
// sidebar always starts open. Remembering it here is what survives a restart.
//
// **A flag only ever hides something the owner already hid.** Anything storage
// cannot be read as an explicit `true` reads as expanded, because the failure
// mode of guessing the other way is an owner who opens the app to a column
// that is missing for reasons he cannot see — so this module coerces rather
// than rejecting, unlike `terminalTabStore.ts` where a half-understood value
// could hand a new tab an old tab's shell.
//
// Storage is `localStorage`, injectable so plain `node --test` (no DOM) can
// pass an in-memory shim — the same arrangement `terminalTabStore.ts` uses.

/** The chrome this app can collapse: the app sidebar, and nothing else. The
 * history of this union — `worktrees`, then `nav` — is in the header; each
 * member left when the column it hid did. */
export type CollapsibleColumn = "sidebar";

/** `true` means collapsed. */
export interface ColumnState {
  sidebar: boolean;
}

export type ColumnLayout = Record<string, ColumnState>;

/** The layout key for the project-less landing view. Prefixed so it cannot
 * collide with a repo id, which is a uuid. */
export const LANDING_KEY = "@landing";

/** Versioned: a future shape change gets a new key rather than a migration,
 * so an older build reading a newer layout finds nothing and starts with
 * everything expanded.
 *
 * `.v2` is that rule being followed, not a tidy-up. The record's shape is
 * unchanged — two independent booleans — but `worktrees: true` used to hide a
 * 224px list of branches, while `nav: true` hides the whole navigation of the
 * workspace, projects included. Carrying a `true` across that rename would
 * open the app, once, to a project whose entire nav is gone for reasons the
 * owner cannot see. `.v1` is never read again and is deliberately left in
 * storage: an older build must still find its own layout. The price, stated:
 * the `sidebar` flag lives in the same record, so one launch starts with
 * everything expanded. */
const LAYOUT_KEY = "vingilot-columns.v2";

const ALL_EXPANDED: ColumnState = { sidebar: false };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage that answers nothing and keeps nothing, for contexts with no
 * `localStorage` (a `node --test` run, a stripped webview). Losing the layout
 * costs one restart's worth of memory; throwing on the way into the workspace
 * screen costs the screen. */
const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** What is collapsed under `key`. An unknown key is everything expanded. */
export function columnsFor(layout: ColumnLayout, key: string): ColumnState {
  return layout[key] ?? ALL_EXPANDED;
}

export function isCollapsed(
  layout: ColumnLayout,
  key: string,
  column: CollapsibleColumn,
): boolean {
  return columnsFor(layout, key)[column];
}

/** Returns the layout unchanged — the same object, not a copy — when the flag
 * already has that value, so a caller mirroring the layout into storage on
 * every change does not write on a no-op. */
export function withColumn(
  layout: ColumnLayout,
  key: string,
  column: CollapsibleColumn,
  collapsed: boolean,
): ColumnLayout {
  const current = columnsFor(layout, key);
  if (current[column] === collapsed) return layout;
  return { ...layout, [key]: { ...current, [column]: collapsed } };
}

export function toggleColumn(
  layout: ColumnLayout,
  key: string,
  column: CollapsibleColumn,
): ColumnLayout {
  return withColumn(layout, key, column, !isCollapsed(layout, key, column));
}

/** Only a literal `true` collapses; every other value, and every absence,
 * reads as expanded. */
function readState(value: unknown): ColumnState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    sidebar: record.sidebar === true,
  };
}

/** Read a stored layout. Missing, unparseable, or wrongly-shaped storage
 * reads as an empty layout — never a throw, because this is called during the
 * render that puts the workspace screen on screen. Keys whose value is not an
 * object are dropped; a key that is fully expanded is dropped too, since it
 * says nothing `columnsFor` does not already default to. */
export function parseColumnLayout(raw: string | null): ColumnLayout {
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
  const layout: ColumnLayout = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "") continue;
    const state = readState(value);
    if (state === null || !state.sidebar) continue;
    layout[key] = state;
  }
  return layout;
}

export function readColumnLayout(
  storage: StorageLike = defaultStorage(),
): ColumnLayout {
  return parseColumnLayout(storage.getItem(LAYOUT_KEY));
}

/** Mirror the whole layout back to storage. A storage that refuses the write
 * (quota, a private-mode webview) costs the next restart its collapsed
 * columns and nothing else. */
export function writeColumnLayout(
  layout: ColumnLayout,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // Losing the layout is survivable; failing the render that produced it
    // is not.
  }
}
