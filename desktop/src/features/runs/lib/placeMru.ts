// Where he has been, and the walk back through it
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).
//
// > *"belki şöyle cmd tab tarzı bir şey"*
//
// **⌘Tab is macOS's and cannot be intercepted**, so the binding is ⌃Tab, which
// is what VS Code uses for this gesture on every platform it runs on. The chord
// itself is `placeKeys.ts`; this module is what the chord walks.
//
// **A place is worktree + pane, and a file as well when the pane is Files.**
// Not a worktree alone: he switches panes inside one checkout far more often
// than he switches checkouts, and a switcher that could not take him back to
// "the Diff I was reading" would answer a question nobody asked. Not a file
// alone either: the file is only part of the address when the pane is the one
// that shows files, and a `file` on a Diff place would be a field with no
// meaning that two places could disagree about.
//
// **It is fed by navigation, and it is not persisted.** Every entry here is put
// there by something the owner did — a worktree selected, a pane switched, a
// file opened — never by a poll or a timer, so the list is his path and not a
// sample of it. And nothing writes it down: no `localStorage`, no coordinator,
// no file. That is deliberate and it is not an omission to fix later. This is a
// **session reflex**: ⌃Tab means "back to what I was just doing", and on a
// fresh app start there is no such thing — a list restored from yesterday would
// answer that question with somewhere he was before lunch, which is a worse
// answer than the overlay declining to open. The pane arrangement, the terminal
// tabs and the column collapse are all persisted precisely because they are
// *arrangements*; this is a trail.
//
// It also means there is nothing here to reset when the community changes: the
// list lives in React state on `RunsScreen`, which is inside the subtree
// `AppReady`'s key remounts, so it dies with the community that made it. A
// module-level cache would have needed a line in `resetCommunityState()`
// (`features/communities/useCommunityInit.ts`) and a seam to put it there.

import type { PaneId } from "./paneModel.ts";

/** How many places are kept.
 *
 * Twelve, and the number is a reading of the gesture rather than of memory. A
 * hold-and-walk switcher is only usable as far as the eye can count rows without
 * reading them — past about a dozen he is reading labels, and reading labels is
 * what ⌘K is for and does better, because it can be typed at. So the cap is the
 * point where this gesture stops being the right one, not a limit on what could
 * be stored. */
export const MRU_CAP = 12;

/** One address in the workspace. */
export interface Place {
  /** The worktree's binding id. */
  worktreeId: string;
  /** Which pane was in the right slot. */
  pane: PaneId;
  /** The open file, worktree-relative — only ever set when `pane` is `files`,
   * and `null` for "the Files pane with nothing open in it". A place carrying a
   * file for any other pane is a place nothing could land on. */
  file: string | null;
}

/** What the Files pane last said it has in its viewer (`PaneAct`'s
 * `file-opened`). The pane is the only surface that knows, so it reports rather
 * than being asked — and it reports **emptiness too**, because "nothing open" is
 * an answer and a silence is not. */
export interface FileReport {
  /** The checkout's own directory, which is how the report names its worktree:
   * two checkouts of one project both have `src/main.rs`. */
  worktree: string;
  /** Worktree-relative, or `null` for "the viewer has nothing in it". */
  path: string | null;
}

/** The workspace's copy of that report, plus the one thing a copy needs: whether
 * it is still a reading of the pane that is on screen *now*.
 *
 * **A report cannot outlive the pane that made it.** `WorkSurface` keys the right
 * pane `${pane}:${identity}`, so a pane switch and a worktree switch both unmount
 * the Files pane, and it comes back with an empty viewer — nothing in it caches a
 * file. A workspace still holding the last report would record a place naming a
 * file that is not open, the honest place ("Files, nothing open") would never be
 * recorded, and the dedupe would quietly merge the phantom onto the earlier real
 * visit.
 *
 * **And the mount key alone cannot tell the two apart**, which is why this is a
 * reducer and not a comparison: leave Files in worktree A for Diff and come back,
 * and the key is `files:A` both times. What separates them is *when* the report
 * arrived relative to the switch, and that is a thing only something with a
 * memory of the last render can say. */
export interface FileReading {
  /** `WorkSurface`'s own key for the right pane, `${pane}:${worktreeId}`. */
  mount: string;
  /** The standing report, held by identity, or `null` before any pane has
   * spoken. */
  report: FileReport | null;
  /** True while `report` came from the pane mounted under `mount`. */
  live: boolean;
}

export const NO_FILE_READING: FileReading = {
  live: false,
  mount: "",
  report: null,
};

/** Fold one render's worth of facts into the reading.
 *
 * Two rules, in this order:
 *
 * 1. **A report that just arrived is live.** It can only have come from the pane
 *    mounted now — a pane that has been unmounted has nothing to say. This is
 *    checked first so that a report and a mount change landing in the same
 *    render resolve to the newer of the two, which is the report.
 * 2. **A mount that just changed makes the standing report stale.** The surface
 *    that made it is gone; the one that replaced it has not spoken yet.
 *
 * Returns the reading it was given, unchanged and by identity, when neither
 * happened — which is what makes this safe to fold during render on a screen
 * that re-renders on a 2s poll, and what makes a second call with the same
 * arguments (`<React.StrictMode>` double-invokes a render) a no-op. */
export function readFileReport(
  prev: FileReading,
  mount: string,
  report: FileReport | null,
): FileReading {
  if (report !== prev.report) return { live: true, mount, report };
  if (mount !== prev.mount) return { live: false, mount, report };
  return prev;
}

/** Two places are the same place when this string is.
 *
 * Joined on NUL, written as an escape rather than typed: it is the one byte a
 * path cannot contain and no id in this app carries, so no worktree id and no
 * filename can fake a boundary and spell two addresses into one. */
const SEP = "\u0000";

export function placeKey(place: Place): string {
  return [place.worktreeId, place.pane, place.file ?? ""].join(SEP);
}

/** Record that he is at `place` now.
 *
 * Most recent first, deduped by `placeKey` — going back somewhere **moves** it
 * to the head rather than adding a second copy, which is what makes ⌃Tab
 * toggling between two places work: after landing on B the list is `[B, A, …]`,
 * so the next ⌃Tab is A again.
 *
 * Returns the list it was given, unchanged and by identity, when `place` is
 * already the head. That is not an optimisation — it is what keeps this safe to
 * call from a React effect that runs on every render of a screen that
 * re-renders on a 2s poll. */
export function rememberPlace(
  places: readonly Place[],
  place: Place,
): readonly Place[] {
  const key = placeKey(place);
  const head = places[0];
  if (head !== undefined && placeKey(head) === key) return places;
  const rest = places.filter((held) => placeKey(held) !== key);
  return [place, ...rest].slice(0, MRU_CAP);
}

/** The switcher, while the owner is holding ⌃.
 *
 * `index` is the row the overlay highlights and the row a release lands on.
 * `null` is closed — one field rather than an `open` boolean beside it, because
 * "open with no highlighted row" is a state the gesture has no meaning in and a
 * pair of fields is a pair that can drift into it. */
export interface SwitcherState {
  readonly index: number | null;
}

export const SWITCHER_CLOSED: SwitcherState = { index: null };

/** One press of Tab (or ⇧Tab) while ⌃ is down.
 *
 * **The first press moves to index 1, not 0.** Index 0 is where he already is,
 * so a first step that highlighted it would make the whole gesture a no-op and
 * a tap of ⌃Tab do nothing — which is the opposite of the reflex it exists to
 * answer. So `stepSwitcher` from closed is a step *from* the head.
 *
 * **A tap is not a second rule.** Press-and-release with no further Tab is one
 * step to index 1 and then a landing on index 1, which is the previous place.
 * The alt-tab reflex and the held walk are the same reducer; nothing here
 * measures how long ⌃ was down, and nothing needs to.
 *
 * It wraps at both ends, so ⇧Tab from closed lands on the *oldest* place — a
 * list you cannot fall off is one you can drive without watching where you are
 * (the palette's own rule, `moveCursor`).
 *
 * Fewer than two places is closed, whatever was asked. One place is where he is
 * standing, and an overlay offering to take him there is an overlay that
 * flashes and does nothing. */
export function stepSwitcher(
  state: SwitcherState,
  count: number,
  delta: number,
): SwitcherState {
  if (count < 2) return SWITCHER_CLOSED;
  const from = state.index ?? 0;
  // Two `% count`s: the first can leave a negative for a ⇧Tab off the front,
  // and the second is what brings it back into range.
  const next = (((from + delta) % count) + count) % count;
  return { index: next };
}

/** Where releasing ⌃ lands, or `null` when it lands nowhere — the switcher was
 * closed, or the list shrank out from under an open one (a worktree removed
 * while he held the key). A landing on `undefined` would be a navigation to
 * nothing. */
export function switcherLanding(
  state: SwitcherState,
  places: readonly Place[],
): Place | null {
  if (state.index === null) return null;
  return places[state.index] ?? null;
}
