// The palette, wired: the key that opens it, the query, the cursor, the
// recents it remembers, and the one call that runs a row.
//
// Every decision here is somewhere else — what a chord means is
// `paletteKeys.ts`, what can be offered is `paletteSources.ts`, how it is
// ordered is `paletteModel.ts`, what a recent is and where it lives is
// `paletteStore.ts`, and what a leading `?` turns the query into is
// `askMode.ts`. What is left is the part that cannot be tested without React,
// plus the one thing only a running app can settle: **how ⌘K is taken from
// upstream's search dialog.**
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
// The claim is as wide as this hook's lifetime, and there are now **two**
// hosts of it: `RunsScreen`'s, on /workspace, and `ShellPalette`'s, mounted at
// the root route for every other screen (`paletteClaim.ts` is what keeps
// exactly one of them bound at a time). So ⌘K is one gesture app-wide — which
// is Task 2's whole subject, and the owner's *"cmd k buzz kısmında farklı deck
// kısmında farklı çalışıyor"*.
//
// **Upstream's search is not removed, it is inside.** Its channel list is a
// source here (`paletteSources.ts`'s `channelSource`, read from the same
// `useChannelsQuery` its own dialog reads), a channel row navigates through the
// same `goChannel`, and the sidebar's "Search everything" button still opens
// their dialog with a click on every screen including this one. What changed is
// which surface a key lands on, not which surfaces exist.

import * as React from "react";

import {
  type Ask,
  type AskInputs,
  askState,
  readAsk,
} from "@/features/runs/lib/askMode";
import {
  composerHoldsGo,
  readComposerCaret,
} from "@/features/runs/lib/composerClaim";
import {
  type PaletteDoor,
  type PaletteHint,
  paletteHints,
  type PaletteMode,
  palettePlaceholder,
  type PaletteSourceId,
  readPaletteQuery,
} from "@/features/runs/lib/paletteDoors";
import { resolvePaletteKey } from "@/features/runs/lib/paletteKeys";
import {
  subscribePaletteRequest,
  takePaletteRequest,
} from "@/features/runs/lib/paletteRequest";
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
  sourceIdsForMode,
  sourcesForMode,
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
  /** Which chord opened it. */
  door: PaletteDoor;
  /** Which sources the list is showing — the door, unless a `>` or a `#` moved
   * it (`paletteDoors.ts`). */
  mode: PaletteMode;
  /** The prefix in force, or `null`. */
  prefix: string | null;
  /** What the empty field says, which is the only thing on screen naming the
   * list underneath it. */
  placeholder: string;
  /** The doors the hint row may teach here: never the one he is standing in,
   * and never one this host has no sources for. Assembled here rather than in
   * the surface because `offers` is this hook's — a component that had to be
   * handed the host's capabilities to draw a footer would be a second place
   * that knows what a host can answer for. */
  hints: readonly PaletteHint[];
  /** The ask the query describes, or `null` while the query is a filter. When
   * it is set the list is empty and the palette is answering a different
   * question — see `askMode.ts`. */
  ask: Ask | null;
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
  /** Run the row the cursor is on now — or, in ask mode, ask the question.
   * Separate from `run` because the key listener that calls it is bound once
   * for the life of an open palette and must not carry the cursor it was bound
   * with. */
  runCursor: () => void;
}

const EMPTY_VIEW: PaletteView = { recentCount: 0, rows: [] };

interface Options {
  context: PaletteContext;
  /** Where an ask would go, and whether anything is there to answer it. The
   * harness reading is the pane registry's own probe, passed down rather than
   * asked again — two answers to "is there an agent?" is one too many. */
  ask: Omit<AskInputs, "question">;
  onCommand: (command: PaletteCommand) => void;
  /** Overridable for tests and for nothing else. When given it replaces the
   * mode's own list, which is why it is not the way a door is selected. */
  sources?: readonly PaletteSource[];
  /** **What this host can answer for**, by source name, or `undefined` for
   * everything (`paletteSources.ts`'s `sourcesForMode`).
   *
   * It does two jobs, and they are one rule: it narrows the list a door shows,
   * and — because a door whose sources are all absent has nothing to show at
   * all — it decides **which chords this host answers to**. ⌘P on a chat route
   * is the case that matters: with no worktree there are no files, so the chord
   * is neither resolved nor prevented and falls through untouched. A chord this
   * app answers with an empty box is a chord the owner learns not to press,
   * which is the opposite of a muscle memory. */
  offers?: readonly PaletteSourceId[];
}

export function usePalette({
  ask: askInputs,
  context,
  offers,
  onCommand,
  sources,
}: Options): Palette {
  const [open, setOpen] = React.useState(false);
  const [door, setDoor] = React.useState<PaletteDoor>("go");
  const [query, setQueryState] = React.useState("");
  const [cursor, setCursorState] = React.useState(0);
  const [recents, setRecents] = React.useState<string[]>(readRecents);

  React.useEffect(() => {
    writeRecents(recents);
  }, [recents]);

  // Assembled only while the palette is on screen: the sources walk every
  // project, worktree and pane, and this hook lives on a component that
  // re-renders on a 2s poll.
  // Which sources the field is currently pointed at, and the text with the
  // prefix taken off. The grammar is a pure function of the door and the raw
  // query (`paletteDoors.ts`), which is why it is read during render rather
  // than held: there is no way to be in a mode the field does not say, and no
  // way to leave one except by deleting the character that chose it.
  const { mode, prefix, query: trimmed } = readPaletteQuery(door, query);
  // Ask mode is the query's own shape, not a second piece of state: there is no
  // way to be in it with a query that is not a question, and no way to leave it
  // except by deleting the prefix — which is the same gesture that put it on.
  const question = open ? readAsk(query) : null;
  const ask =
    question === null ? null : askState({ ...askInputs, question: question });
  const view =
    open && ask === null
      ? assembleView(
          paletteMatches(
            context,
            trimmed,
            sources ?? sourcesForMode(mode, offers),
          ),
          trimmed,
          recents,
        )
      : EMPTY_VIEW;
  // Clamped rather than corrected in an effect: a cursor past the end of a
  // list that just shrank must never be the index `run` reads, and an effect
  // would leave one render in which it is.
  const safeCursor = cursor < view.rows.length ? cursor : 0;

  // Read by callbacks that must not be rebound as the owner types — the key
  // listener below is bound over a screen rendering a live terminal.
  const latest = React.useRef({ ask, onCommand, rows: view.rows, safeCursor });
  latest.current = { ask, onCommand, rows: view.rows, safeCursor };

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

  // Enter, whichever mode the palette is in. An ask records no recent — a
  // recent is a row the owner ran, and a question is not a row; it has its own
  // history, and it is a better one (`askThread.ts`).
  const runCursor = React.useCallback(() => {
    const pendingAsk = latest.current.ask;
    if (pendingAsk === null) {
      run(latest.current.safeCursor);
      return;
    }
    // Blocked reads the same here as on a row: nothing happens and the palette
    // stays open, because the sentence saying why is already on screen and
    // closing would look like the question had gone somewhere.
    if (pendingAsk.blocked !== null) return;
    setOpen(false);
    latest.current.onCommand({
      question: pendingAsk.question,
      type: "ask",
    });
  }, [run]);

  // The doors this host will answer to, read through a ref so the listener
  // below is still bound once for the life of the hook — it is registered over
  // a screen that re-renders on a 2s poll, and a re-register drops the events
  // that land in the gap.
  const doorsOpen = React.useRef({ door, offers });
  doorsOpen.current = { door, offers };

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
      // **The fall-through.** A door this host has no source for is not this
      // hook's chord: it is neither prevented nor stopped, so ⌘P on a chat
      // route reaches whatever else wants it. See `Options.offers`.
      if (
        sourceIdsForMode(action.door, doorsOpen.current.offers).length === 0
      ) {
        return;
      }
      // **The second fall-through: upstream's composer keeps the ⌘K it
      // actually uses.** Its link editor claims the chord at the element level
      // and only when the shortcut applies, and a capture listener that stopped
      // propagation here would take it unconditionally — see
      // `composerClaim.ts`, which is the claimant check re-run for the app-wide
      // scope. Read from the document rather than from state: the answer is
      // about where the caret is *at this keystroke*.
      if (
        action.door === "go" &&
        composerHoldsGo(readComposerCaret(event.target, window.getSelection()))
      ) {
        return;
      }
      // See this file's header: both calls, and why each is there.
      event.preventDefault();
      event.stopPropagation();
      setOpen((prev) => {
        // **A second chord on an open palette changes the list, it does not
        // close it.** ⌘P from an open ⌘K is "no, files" — a surface that shut
        // and reopened there would flicker, and one that ignored the chord
        // would make the doors reachable only from a closed palette. Closing is
        // still what the *same* chord does, which is the way out the owner
        // already knows.
        const next = prev ? action.door !== doorsOpen.current.door : true;
        // Opening — or switching — is always onto a fresh query. A palette that
        // reopened holding the last search would answer a question the owner
        // asked minutes ago, and he would have to clear it before he could ask
        // his.
        if (next) {
          setDoor(action.door);
          setQueryState("");
          setCursorState(0);
        }
        return next;
      });
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // **The top bar's click, answered like the chord** (vingilot redesign P1).
  // The search pill and the History button post through `paletteRequest.ts`;
  // whichever host is mounted consumes it here. Unlike the chord, a click
  // always *opens* — a pill is not a toggle — and a request posted before this
  // host mounted is drained on mount so a click racing a route change still
  // lands. Doors this host has no sources for are refused for the chord's own
  // reason (an empty box teaches the owner not to press the key).
  React.useEffect(() => {
    function consume() {
      const requested = takePaletteRequest();
      if (requested === null) return;
      if (sourceIdsForMode(requested, doorsOpen.current.offers).length === 0) {
        return;
      }
      setDoor(requested);
      setQueryState("");
      setCursorState(0);
      setOpen(true);
    }
    consume();
    return subscribePaletteRequest(consume);
  }, []);

  return {
    ask,
    close,
    cursor: safeCursor,
    door,
    hints: paletteHints(mode, offers),
    mode,
    moveCursor: React.useCallback((delta: number) => {
      setCursorState((prev) => {
        const rows = latest.current.rows.length;
        return moveCursorIn(prev < rows ? prev : 0, delta, rows);
      });
    }, []),
    open,
    placeholder: palettePlaceholder(mode),
    prefix,
    query,
    run,
    runCursor,
    setCursor: setCursorState,
    setQuery,
    view,
  };
}
