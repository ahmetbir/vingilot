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

export interface Panes {
  /** The selected worktree's arrangement. */
  state: PaneState;
  choose: (pane: PaneId) => void;
  setRatio: (ratio: number) => void;
  nudgeRatio: (delta: number) => void;
  resetRatio: () => void;
  toggleCollapsed: () => void;
}

export function usePanes(worktreeId: string | null): Panes {
  const [layout, setLayout] = React.useState<PaneLayout>(readPaneLayout);
  React.useEffect(() => {
    writePaneLayout(layout);
  }, [layout]);

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
    (ratio: number) => edit((prev, at) => withRatio(prev, at, ratio)),
    [edit],
  );
  const nudge = React.useCallback(
    (delta: number) => edit((prev, at) => nudgeRatio(prev, at, delta)),
    [edit],
  );
  const reset = React.useCallback(
    () => edit((prev, at) => resetRatio(prev, at)),
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
