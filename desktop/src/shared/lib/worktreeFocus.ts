// **Which checkout the rest of the app is standing in**
// (vingilot/docs/plans/2026-08-29-redesign.md, P5).
//
// The Pull requests pane draws the pull requests of the repository behind
// *whichever worktree is selected* — and it draws them in the sidebar, on the
// `/projects` route, where `RunsScreen` (the component that holds the
// selection) is **not mounted**: the workspace is its own lazy chunk under
// `/workspace`. So the pane cannot read the selection; the workspace has to
// hand it over.
//
// This is `paletteWorld.ts`'s problem and it takes `paletteWorld.ts`'s answer,
// deliberately smaller: the workspace **publishes** the one checkout it has
// open, and anything outside the workspace reads it. Nothing here polls,
// nothing here calls a backend, nothing here is authoritative. The live
// selection is still `RunsScreen`'s.
//
// **It is honest about being a copy, and the island makes that safe.** The
// worst a stale path can do is reach `pulls_list` and come back
// `not-a-repo{path, enclosing}` — a refusal with a sentence, naming the path
// it was asked about. A directory that has been deleted or moved therefore
// reads as "this is no longer a checkout", never as "this repository has no
// pull requests". That is the whole reason this module is allowed to persist.
//
// **Persisted, and that is the feature.** A cold start on `/projects` has
// never mounted the workspace. Without a stored focus the pane's only truthful
// sentence would be "nothing is selected", which is a false statement about a
// machine that had a checkout open a minute ago. `localStorage` is the same
// tolerance `paletteWorld.ts` and `paletteStore.ts` take, for the same reason.
//
// **No entry in `resetCommunityState()`.** That list is for module-level
// caches holding *community-scoped* data (`useCommunityInit.ts`). A worktree is
// a directory on this disk; it does not change meaning when the relay does.

import * as React from "react";

/** The checkout the workspace has open, as a surface outside it needs it. */
export interface WorktreeFocus {
  /** The checkout's own directory — the argument `pulls_list` takes. Absolute,
   * because that is what `worktreeCwd()` produces and what git needs. */
  path: string;
  /** The owning project's name, as the workspace names it. Carried so a pane
   * can say *whose* pull requests it is about to read before the island has
   * answered with the real `owner/name` — and so the loading sentence names
   * something the owner recognises rather than a path. */
  repoName: string;
  /** The worktree's own label — its branch, or its role for a primary
   * checkout. The same string the nav row shows. */
  label: string;
}

/** Versioned like `paletteWorld.ts`'s key: a shape change gets a new key
 * rather than a migration, so an older build reading a newer snapshot finds
 * nothing and says "nothing selected" instead of half-understanding it. */
const FOCUS_KEY = "vingilot-worktree-focus.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NO_STORAGE: StorageLike = { getItem: () => null, setItem: () => {} };

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read a stored focus. Anything malformed — and anything missing the path,
 * which is the only field a reader can *do* something with — reads as "no
 * focus" rather than as a half-built object. Never throws: this runs during
 * the render that puts the sidebar on screen. */
export function parseFocus(raw: string | null): WorktreeFocus | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const held = parsed as Record<string, unknown>;
  const path = stringOf(held.path);
  if (path === null) return null;
  return {
    label: stringOf(held.label) ?? "",
    path,
    repoName: stringOf(held.repoName) ?? "",
  };
}

let focus: WorktreeFocus | null = null;
let loaded = false;
type Listener = () => void;
const listeners = new Set<Listener>();

/** The focus as a reader sees it right now. */
export function readFocus(
  storage: StorageLike = defaultStorage(),
): WorktreeFocus | null {
  if (!loaded) {
    focus = parseFocus(storage.getItem(FOCUS_KEY));
    loaded = true;
  }
  return focus;
}

function same(a: WorktreeFocus | null, b: WorktreeFocus | null): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.repoName === b.repoName && a.label === b.label;
}

/** The workspace's one checkout, or `null` when it has none open.
 *
 * Called from an effect on a screen that re-renders on a 2s poll, so it
 * returns without writing when nothing moved. */
export function publishFocus(
  next: WorktreeFocus | null,
  storage: StorageLike = defaultStorage(),
): void {
  if (same(readFocus(storage), next)) return;
  focus = next;
  try {
    storage.setItem(FOCUS_KEY, next === null ? "" : JSON.stringify(next));
  } catch {
    // Losing the snapshot costs the next cold start its list and nothing else;
    // failing the render that produced it is not survivable.
  }
  for (const listen of [...listeners]) {
    try {
      listen();
    } catch {
      // A subscriber's failure is not the publisher's.
    }
  }
}

export function subscribeFocus(listen: Listener): () => void {
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
  };
}

/** The focus, live. `useSyncExternalStore` rather than an effect + state, so a
 * pane mounted after the publish still reads the current value on its first
 * render instead of flashing "nothing selected". */
export function useWorktreeFocus(): WorktreeFocus | null {
  return React.useSyncExternalStore(
    subscribeFocus,
    () => readFocus(),
    () => null,
  );
}

/** Drop the in-memory copy and every subscriber. For tests. */
export function resetWorktreeFocus(): void {
  focus = null;
  loaded = false;
  listeners.clear();
}
