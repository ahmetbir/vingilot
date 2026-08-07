// The palette, wired: the key that opens it, the query, the cursor, the
// recents it remembers, and the one call that runs a row.
//
// Every decision here is somewhere else — what a chord means is
// `paletteKeys.ts`, what can be offered is `paletteSources.ts`, how it is
// ordered is `paletteModel.ts`, what a recent is and where it lives is
// `paletteStore.ts`. What is left is the part that cannot be tested without
// React, plus the one thing only a running app can settle: **how ⌘K is taken
// from upstream's search dialog.**
//
// **Capture phase, on `window`.** Upstream binds its ⌘K handler as a
// bubble-phase `window` listener (app/AppShell.tsx), and a bubble listener on
// `window` is the *last* thing an event reaches. Registering ours in the
// capture phase makes it the first, whatever order the two components mounted
// in — which matters, because this screen mounts inside that shell and would
// otherwise always be second.
//
// Two calls make the claim, and they are not redundant:
//
// - `preventDefault()` is the path upstream itself documents: its handler
//   returns early on `event.defaultPrevented`, for exactly this case ("a
//   focused surface may claim the shortcut first"). Using it means the claim
//   is made through a seam upstream wrote rather than around it.
// - `stopPropagation()` is the belt. Stopping at the window-capture stage
//   keeps the event out of the target and bubble phases entirely, so the claim
//   survives upstream dropping that guard in a later merge. Not
//   `stopImmediatePropagation`: other capture listeners on `window` are none
//   of this module's business.
//
// The claim is only as wide as this hook's lifetime, and this hook is
// `RunsScreen`'s — mounted on /workspace and nowhere else. Every other screen
// keeps ⌘K for upstream's search, and the sidebar's "Search everything" button
// still opens it with a click on this screen too.

import * as React from "react";

import { resolvePaletteKey } from "@/features/runs/lib/paletteKeys";
import {
  assembleView,
  moveCursor as moveCursorIn,
  type PaletteCommand,
  type PaletteView,
} from "@/features/runs/lib/paletteModel";
import {
  type PaletteContext,
  paletteMatches,
  type PaletteSource,
  PALETTE_SOURCES,
} from "@/features/runs/lib/paletteSources";
import {
  readRecents,
  withRecent,
  writeRecents,
} from "@/features/runs/lib/paletteStore";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

export interface Palette {
  open: boolean;
  query: string;
  /** The row Enter would run. Always a valid index into `view.rows`, or 0 for
   * an empty list. */
  cursor: number;
  view: PaletteView;
  setQuery: (query: string) => void;
  /** Wraps at both ends (`moveCursor`) — a list you cannot fall off is one you
   * can drive without watching where you are. */
  moveCursor: (delta: number) => void;
  setCursor: (index: number) => void;
  close: () => void;
  /** Run the row at `index`. A blocked row runs nothing, records nothing and
   * leaves the palette open — its own sentence is already on screen saying
   * why, and closing would look like it had worked. */
  run: (index: number) => void;
}

const EMPTY_VIEW: PaletteView = { recentCount: 0, rows: [] };

interface Options {
  context: PaletteContext;
  onCommand: (command: PaletteCommand) => void;
  /** Overridable for tests and for nothing else. */
  sources?: readonly PaletteSource[];
}

export function usePalette({
  context,
  onCommand,
  sources = PALETTE_SOURCES,
}: Options): Palette {
  const [open, setOpen] = React.useState(false);
  const [query, setQueryState] = React.useState("");
  const [cursor, setCursorState] = React.useState(0);
  const [recents, setRecents] = React.useState<string[]>(readRecents);

  React.useEffect(() => {
    writeRecents(recents);
  }, [recents]);

  // Assembled only while the palette is on screen: the sources walk every
  // project, worktree and pane, and this hook lives on a component that
  // re-renders on a 2s poll.
  const trimmed = query.trim();
  const view = open
    ? assembleView(paletteMatches(context, trimmed, sources), trimmed, recents)
    : EMPTY_VIEW;
  // Clamped rather than corrected in an effect: a cursor past the end of a
  // list that just shrank must never be the index `run` reads, and an effect
  // would leave one render in which it is.
  const safeCursor = cursor < view.rows.length ? cursor : 0;

  // Read by callbacks that must not be rebound as the owner types — the key
  // listener below is bound over a screen rendering a live terminal.
  const latest = React.useRef({ onCommand, rows: view.rows, safeCursor });
  latest.current = { onCommand, rows: view.rows, safeCursor };

  const setQuery = React.useCallback((next: string) => {
    setQueryState(next);
    // A new query is a new list; the cursor belongs to the top of it.
    setCursorState(0);
  }, []);

  const close = React.useCallback(() => setOpen(false), []);

  const run = React.useCallback((index: number) => {
    const match = latest.current.rows[index];
    if (match === undefined) return;
    const { blocked, command, id } = match.candidate;
    if (blocked !== null) return;
    setRecents((prev) => withRecent(prev, id));
    setOpen(false);
    latest.current.onCommand(command);
  }, []);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = resolvePaletteKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      // See this file's header: both calls, and why each is there.
      event.preventDefault();
      event.stopPropagation();
      setOpen((prev) => {
        // Opening is always onto a fresh query. A palette that reopened
        // holding the last search would answer a question the owner asked
        // minutes ago, and he would have to clear it before he could ask his.
        if (!prev) {
          setQueryState("");
          setCursorState(0);
        }
        return !prev;
      });
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  return {
    close,
    cursor: safeCursor,
    moveCursor: React.useCallback((delta: number) => {
      setCursorState((prev) => {
        const rows = latest.current.rows.length;
        return moveCursorIn(prev < rows ? prev : 0, delta, rows);
      });
    }, []),
    open,
    query,
    run,
    setCursor: setCursorState,
    setQuery,
    view,
  };
}
