// ⌘F, and the three keys the bar it opens answers to
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 1).
//
// **Where the ⌘F boundary is, in one paragraph, because this is the part that is
// easy to get wrong quietly.** ⌘F is *upstream's* chord: `features/search/
// useChannelFind.ts:139-154` binds it on `window` (bubble phase) and opens
// find-in-this-channel wherever a channel screen is mounted — which in the
// workspace includes the Team pane, since `TeamThreadPane` hosts
// `ChannelRouteScreen` itself. So this island does **not** take ⌘F globally. It
// takes it in one place and gives it back everywhere else:
//
//   `lib/useFindInFile.ts` listens on `window` in the **capture** phase, and
//   claims the event only when the Files pane has a file open AND the keydown's
//   target is inside that pane's own root (or nothing is focused at all). When it
//   claims, it calls `stopPropagation`, which — from the capture phase, before
//   the event has reached its target — is what keeps it from ever arriving at
//   upstream's bubble listener on the same node. When it does not claim, it does
//   nothing, and upstream's handler runs exactly as it did before.
//
// That is why the notes pane, the plan pane, the team thread's composer and
// the palette's field keep ⌘F untouched: none of them is inside `pane-files`.
//
// **xterm's textarea was the one deliberate omission here, and it is closed.**
// `lib/useTerminalFind.ts` is the identical pattern this header already
// describes — a capture-phase window listener, `stopPropagation` before
// upstream's bubble handler ever sees the event — keyed off "the terminal
// pane has focus" instead of "a file is open", walking `@xterm/addon-search`'s
// own match set instead of a string search over `file.text`. The two
// listeners coexist because each checks its own pane's ownership before
// claiming anything: a ⌘F over the Files pane still opens this bar, a ⌘F over
// the terminal opens that one, and a ⌘F anywhere else — the notes pane, the
// plan pane, the team thread's composer, the palette's field — still reaches
// upstream's find-in-this-channel exactly as it did before either existed.
//
// `resolveFindKey` and `resolveFindBarKey` below are reused verbatim by the
// terminal's hook: they were already pane-agnostic pure functions, resolving
// a keydown into a meaning with no reference to what "this pane" is. Only the
// *ownership* check (which ⌘F becomes this pane's) is pane-specific, and each
// pane's hook carries its own — `FindBarModel`, below, is the interface both
// hooks answer so `ui/FindBar.tsx` can draw either one without knowing which.
//
// **Deliberately not in `cheatsheet.ts`'s `KEY_MAPS`.** Every map listed there is
// answered by the *screen*, so the sheet can print its chord as a fact. This one
// is answered by a pane, only while that pane is up and holds focus, and only
// while it has a file open. Printing "⌘F — find in this file" on a sheet the
// owner reads over the Team pane would be printing something untrue; printing
// nothing loses him a discovery. The bar states its own rule in the field's title
// instead, which is where he is when the question comes up. Written down here so
// the absence reads as a decision rather than an oversight.

import type * as React from "react";

import type { KeyInput } from "./terminalKeys.ts";

/** Open the find bar over the file the viewer is showing. Pressing it again with
 * the bar already up re-focuses and selects the field — the same choice
 * `searchKeys.ts` made and for the same reason: a find chord that closed the bar
 * on the second press takes the results away from the one gesture that means
 * "let me retype that". */
export type FindKeyAction = { type: "open-find" };

/** Resolves one keydown into "find in this file", or `null`. Never throws. */
export function resolveFindKey(input: KeyInput): FindKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and every one of them
  // would re-select the field out from under what he is typing.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥⌘F is nobody's. Claiming it by ignoring ⌥ would take a chord nothing has
  // checked the claimants for.
  if (input.altKey === true) return null;
  // ⇧⌘F is `searchKeys.ts` — search the whole checkout. Two different questions,
  // two different chords, which is also what VS Code does.
  if (input.shiftKey === true) return null;
  // Lower-cased because a caps-locked keyboard reports "F", and the chord he
  // pressed is the same chord.
  return input.key.toLowerCase() === "f" ? { type: "open-find" } : null;
}

/** What the bar itself answers to, once it is up and the caret is in its field.
 *
 * Enter walks forward, ⇧Enter back, Escape closes and hands focus to the viewer.
 * These are the browser's own find bar's keys and VS Code's, and they are here
 * rather than in the component so that "⇧Enter goes backwards" is a claim with a
 * test rather than a branch in a JSX handler. */
export type FindBarAction =
  | { type: "next" }
  | { type: "previous" }
  | { type: "close" };

/** Resolves one keydown inside the find field. `null` for every key that is
 * ordinary typing, which is nearly all of them. Never throws. */
export function resolveFindBarKey(input: KeyInput): FindBarAction | null {
  // Escape is answered even on auto-repeat: it is idempotent, and a bar that
  // refused to close because the key was held would be a trap.
  if (input.key === "Escape") {
    // ⌘Escape and ⌥Escape are the system's, not this bar's.
    if (input.primaryModifier || input.altKey === true) return null;
    return { type: "close" };
  }
  if (input.key !== "Enter") return null;
  // ⌘Enter and ⌥Enter are not a walk. Nothing in this bar claims them, and a
  // walk that fired on them would fire on a chord some other surface may want.
  if (input.primaryModifier || input.altKey === true) return null;
  return input.shiftKey === true ? { type: "previous" } : { type: "next" };
}

/** Everything `ui/FindBar.tsx` actually reads off a find state, and nothing
 * more. Files' `useFindInFile` and the terminal's `useTerminalFind` each
 * return a superset of this (their own `open`, and whatever they need to
 * decide what to render inside the pane), but the bar itself is drawn from
 * exactly these fields — which is what lets one component draw both bars
 * without importing either hook.
 *
 * `matchCount` rather than `matches: unknown[]`: the bar only ever reads a
 * count (to grey the walk buttons), and a terminal search has no array of
 * matches to hand over — `@xterm/addon-search` reports a count and an index,
 * not offsets. A count is the honest shape for both. */
export interface FindBarModel {
  query: string;
  matchCount: number;
  /** `"3/17"`, or the no-results sentence — already formatted, so the bar
   * never has to know how a pane counts. */
  label: string;
  /** How many times the chord has been pressed. The field watches this so a
   * second ⌘F re-selects what is already typed. */
  opened: number;
  setQuery: (query: string) => void;
  walk: (direction: 1 | -1) => void;
  close: () => void;
  onFieldKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}
