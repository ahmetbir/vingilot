// The find bar's state, and the one place ⌘F is taken from upstream
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// **Read `findKeys.ts`'s header first** — it is where the ⌘F boundary is argued.
// This file is the enforcement: the capture-phase listener, and the two
// conditions under which it claims the chord.
//
// Everything about *matching* is `findInFile.ts` and is proved without a browser.
// What is here is the part that needs a window: which keydowns are this pane's,
// and where focus goes when the bar closes.

import * as React from "react";

import {
  type FindLine,
  type FindMatch,
  currentMatchIndex,
  findMatches,
  indexLines,
  matchLabel,
  stepMatch,
} from "@/features/runs/lib/findInFile";
import {
  resolveFindBarKey,
  resolveFindKey,
} from "@/features/runs/lib/findKeys";
import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

/** What the bar draws itself from, and what the viewer paints from. */
export type FindInFile = {
  /** True while the bar is on screen. */
  open: boolean;
  query: string;
  /** Every match in the file, in the file's order. */
  matches: FindMatch[];
  /** The same set, per line, for the renderer (`indexLines`). `null` while the
   * bar is shut or the query is empty — which the renderer reads as "draw the
   * file exactly as it did before ⌘F existed", so the find costs a closed pane
   * nothing at all. */
  lines: FindLine[] | null;
  /** Which match is emphasised, clamped; `-1` when there is none. */
  current: number;
  /** `"3/17"`, or the no-results sentence. */
  label: string;
  /** How many times the chord has been pressed — the field watches this so a
   * second ⌘F re-selects what is already typed. */
  opened: number;
  setQuery: (query: string) => void;
  walk: (direction: 1 | -1) => void;
  close: () => void;
  /** The keydown handler for the bar's own field (Enter / ⇧Enter / Escape). */
  onFieldKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

/** Whether a ⌘F that arrived at the window belongs to this pane.
 *
 * Two ways to say yes, and both are deliberate:
 *
 * - **The target is inside the pane.** He clicked a row, or walked the tree with
 *   the arrow keys, or the caret is already in the find field — the ordinary
 *   case, and the one that makes the notes pane, the plan pane, the team
 *   thread's composer and xterm's own textarea keep ⌘F, since none of them is
 *   inside this root.
 * - **Nothing is focused.** After a click on the viewer's own body — which is a
 *   `<pre>`, so the click lands on `document.body` — no element holds focus, and
 *   `contains` would say no. Answering no there would be a ⌘F that does nothing
 *   at all in a pane that is plainly the thing he is looking at. So `body` and
 *   the document element count as "this pane, because nobody else claimed
 *   focus"; the caller has already established that this pane is the one with a
 *   file open. */
function ownsChord(target: EventTarget | null, pane: HTMLElement | null) {
  if (pane === null) return false;
  if (target === null) return true;
  if (!(target instanceof Node)) return false;
  const document = pane.ownerDocument;
  if (target === document.body || target === document.documentElement) {
    return true;
  }
  return pane.contains(target);
}

/**
 * @param text The file's text — the thing being searched, never the rendered
 *   spans (`findInFile.ts`'s header says why).
 * @param enabled Whether there is a file to search. `false` gives the chord
 *   straight back to upstream: a find bar over the empty state would be a bar
 *   with nothing to count, and a chord that opened one would have taken
 *   find-in-this-channel for the privilege.
 * @param paneRef The pane's own root. The chord boundary is drawn on it.
 * @param viewerRef Where focus goes when the bar closes — the scrolling body, so
 *   Escape leaves him with the arrow keys and PageDown still working on the file
 *   he was reading rather than on nothing.
 */
export function useFindInFile({
  enabled,
  paneRef,
  text,
  viewerRef,
}: {
  enabled: boolean;
  paneRef: React.RefObject<HTMLElement | null>;
  text: string;
  viewerRef: React.RefObject<HTMLElement | null>;
}): FindInFile {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [at, setAt] = React.useState(0);
  const [opened, setOpened] = React.useState(0);

  const matches = React.useMemo(
    () => (open ? findMatches(text, query) : []),
    [open, query, text],
  );
  const lines = React.useMemo(
    () => (matches.length === 0 ? null : indexLines(text, matches)),
    [matches, text],
  );
  const current = currentMatchIndex(matches.length, at);

  // **A new query is a new walk, from the top**, and the reset happens *with* the
  // typing rather than in an effect watching it. Not clamped-and-kept: he retypes
  // to look for something else, and landing on "the 9th match of a word he is no
  // longer looking for" is a place nothing put him. An effect on `query` would
  // have been the same behaviour one render later — and a render in which the
  // label and the emphasis disagree is a flicker he would see on every keystroke.
  const changeQuery = React.useCallback((next: string) => {
    setQuery(next);
    setAt(0);
  }, []);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setAt(0);
    // **Focus goes back to the viewer, not nowhere.** Escape out of a browser's
    // find bar leaves the page focused; a bar that left focus on a button it had
    // just unmounted would leave the whole pane keyboard-dead.
    viewerRef.current?.focus();
  }, [viewerRef]);

  const walk = React.useCallback(
    (direction: 1 | -1) => {
      setAt((now) => stepMatch(matches.length, now, direction));
    },
    [matches.length],
  );

  const onFieldKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const action = resolveFindBarKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event.nativeEvent),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      event.preventDefault();
      // The bar's keys stop here. Escape in particular: upstream's
      // `useMarkAsReadShortcuts` listens for a plain Escape on the window, and a
      // find bar closing must not also mark a channel read.
      event.stopPropagation();
      if (action.type === "close") {
        close();
        return;
      }
      walk(action.type === "next" ? 1 : -1);
    },
    [close, walk],
  );

  // **The capture-phase listener — the whole of the ⌘F boundary.** Capture,
  // because upstream's find-in-channel handler is a bubble-phase listener on this
  // same window: stopping propagation here, before the event has even reached its
  // target, is what keeps it from ever getting there. Registered only while there
  // is a file to search, so a Files pane on its empty state costs upstream
  // nothing.
  React.useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      const action = resolveFindKey({
        altKey: event.altKey,
        key: event.key,
        primaryModifier: hasPrimaryShortcutModifier(event),
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null) return;
      if (!ownsChord(event.target, paneRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      // Counted rather than toggled: the field reads this to select what is
      // already in it, which is the gesture a second ⌘F actually means.
      setOpened((count) => count + 1);
    };
    window.addEventListener("keydown", listener, { capture: true });
    return () =>
      window.removeEventListener("keydown", listener, { capture: true });
  }, [enabled, paneRef]);

  // A file that is no longer open has nothing to find in. The bar goes with it
  // rather than counting matches in a file that is not on screen.
  React.useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  return {
    close,
    current,
    label: matchLabel(matches.length, at),
    lines,
    matches,
    onFieldKeyDown,
    open,
    opened,
    query,
    setQuery: changeQuery,
    walk,
  };
}
