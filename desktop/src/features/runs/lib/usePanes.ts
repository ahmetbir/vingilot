// The selected worktree's pane arrangement, wired: what sits on the right,
// how wide the terminal is, and whether the right slot is showing at all.
//
// Every decision here is somewhere else — the arrangement and its rules are
// `paneModel.ts`, storage is `paneStore.ts`, the chords are `paneKeys.ts`.
// What is left is holding the layout for the whole workspace and mirroring it
// back, which is the part that cannot be tested without React.
//
// It belongs to `RunsScreen` for the same reason the tab layout does: that
// component never unmounts, and `WorkSurface` disappears the moment the owner
// goes back to the landing view. An arrangement kept there would be forgotten
// on the way out, and the owner would come back to a surface he did not
// arrange.
//
// A `null` worktree — the landing view, or the moment before a project's first
// worktree is picked — reads as the default arrangement and accepts no
// changes. Recording one against no key would put it in nobody's storage.

import * as React from "react";

import {
  nudgeRatio,
  type PaneId,
  type PaneLayout,
  type PaneState,
  panesFor,
  resetRatio,
  toggleCollapsed,
  withRatio,
  withRight,
} from "@/features/runs/lib/paneModel";
import { readPaneLayout, writePaneLayout } from "@/features/runs/lib/paneStore";

/** The three ratio setters take the width of the surface the gesture happened
 * on, rather than reading one from anywhere: what is stored has to be a ratio
 * that surface allowed, or it becomes a divider that moves by itself the next
 * time the window is a different size. It is an argument and not a hook
 * dependency so these callbacks stay reference-stable across a resize — they
 * are props of a component that renders a live terminal. */
export interface Panes {
  /** The selected worktree's arrangement. */
  state: PaneState;
  choose: (pane: PaneId) => void;
  setRatio: (ratio: number, surfaceWidth: number) => void;
  nudgeRatio: (delta: number, surfaceWidth: number) => void;
  resetRatio: (surfaceWidth: number) => void;
  toggleCollapsed: () => void;
}

/** How long the layout has to stop changing before it is written down.
 *
 * A drag of the divider changes the ratio on every pointermove — measured at
 * 40 for one short gesture — and each write is a synchronous `JSON.stringify`
 * plus a `localStorage.setItem` on the same frame that is resizing a pty.
 * Short enough that any pause in a gesture commits, and nothing is riding on
 * the write landing promptly: what it protects is the next app start. */
const SETTLE_MS = 200;

export function usePanes(worktreeId: string | null): Panes {
  const [layout, setLayout] = React.useState<PaneLayout>(readPaneLayout);

  // The layout that has changed but not yet been written. Held so leaving the
  // screen mid-drag writes the arrangement rather than dropping it — a
  // debounce whose last change can be cancelled is a debounce that loses work.
  const unwritten = React.useRef<PaneLayout | null>(null);
  React.useEffect(() => {
    unwritten.current = layout;
    const handle = setTimeout(() => {
      unwritten.current = null;
      writePaneLayout(layout);
    }, SETTLE_MS);
    return () => clearTimeout(handle);
  }, [layout]);
  React.useEffect(
    () => () => {
      if (unwritten.current !== null) writePaneLayout(unwritten.current);
    },
    [],
  );

  // Held in a ref so every callback below can be stable: they are props of a
  // component that renders a terminal, and a new identity each render would
  // rebind the work surface's key listener on every keystroke the owner types
  // into that terminal.
  const key = React.useRef(worktreeId);
  key.current = worktreeId;

  const edit = React.useCallback(
    (change: (layout: PaneLayout, key: string) => PaneLayout) => {
      const target = key.current;
      if (target === null) return;
      setLayout((prev) => change(prev, target));
    },
    [],
  );

  const choose = React.useCallback(
    (pane: PaneId) => edit((prev, at) => withRight(prev, at, pane)),
    [edit],
  );
  const setRatio = React.useCallback(
    (ratio: number, surfaceWidth: number) =>
      edit((prev, at) => withRatio(prev, at, ratio, surfaceWidth)),
    [edit],
  );
  const nudge = React.useCallback(
    (delta: number, surfaceWidth: number) =>
      edit((prev, at) => nudgeRatio(prev, at, delta, surfaceWidth)),
    [edit],
  );
  const reset = React.useCallback(
    (surfaceWidth: number) =>
      edit((prev, at) => resetRatio(prev, at, surfaceWidth)),
    [edit],
  );
  const collapse = React.useCallback(
    () => edit((prev, at) => toggleCollapsed(prev, at)),
    [edit],
  );

  return {
    choose,
    nudgeRatio: nudge,
    resetRatio: reset,
    setRatio,
    // The empty string is a key nothing can be stored under — `edit` refuses a
    // null worktree and `parsePaneLayout` drops the key on the way in — so a
    // worktree-less surface reads the default arrangement and cannot record
    // one.
    state: panesFor(layout, worktreeId ?? ""),
    toggleCollapsed: collapse,
  };
}
