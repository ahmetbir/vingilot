// Pure keyboard-resolution for the pane host: the chord that hides the right
// pane, and the keys that move the divider once it has focus. Same shape as
// `terminalKeys.ts` and `columnKeys.ts` — a `resolve*` function so the map is
// unit-testable without React or a real keyboard, and the caller decides
// whether now is the time for it.
//
// **⌥⌘B is VS Code's secondary sidebar**, which is what the right pane is, and
// it was left unclaimed by `columnKeys.ts` until there was a pane to bind it
// to (see the note there). It survives the same four-claimant check that file
// documents: it is not in Tauri's default macOS menu, which claims ⌥⌘H and no
// other ⌥⌘ chord; upstream's window handler claims no ⌥ chord at all; the
// sidebar primitive binds ⌘S; and this island's own maps use ⌥ only for
// ⌥⌘←→.
//
// **⇧⌥⌘B is its mirror**, and this file used to refuse it explicitly so that
// claiming it would have to be a decision rather than an oversight. This is
// the decision. ⌥⌘B gives the terminal the whole surface; ⇧⌥⌘B gives it to the
// right pane — the layout the four ported panes had when they were tabs, which
// the split otherwise takes away for good. It passes the same four-claimant
// check: adding ⇧ to a chord no claimant holds cannot collide with one, and
// `columnKeys.ts` refuses every ⌥ chord, so ⇧⌥⌘B is not also a workspace-nav
// toggle.
//
// **The divider's keys are the reason the divider exists in this file at
// all.** A splitter that only answers a drag is not reachable for someone
// working from the keyboard, and "resize the terminal" is not a niche act in
// an app whose main surface is a terminal. The bindings follow the WAI-ARIA
// window-splitter pattern — arrows move it, Home/End take it to its limits,
// Enter collapses and restores — with `0` for the reset that a mouse gets by
// double-clicking, chosen to rhyme with the ⌘0 that resets zoom.
//
// **Home and End mean the limits, and now reach them.** They used to resolve
// to `MIN_RATIO` and `MAX_RATIO`, which are a matter of taste and not limits
// of anything: on a 1195px surface Home left the right pane at 442px of 1195
// and called that "its limits". They now hand the surface to one side outright,
// which is what the pattern says they do and what the tab bar this replaced
// could already do.
//
// These keys are resolved only from the divider's own handler, never from the
// window: unmodified arrows belong to whatever has focus, and a global arrow
// binding would move the split while the owner was moving a cursor.

import type { PaneSide } from "./paneModel.ts";
import { RATIO_STEP, RATIO_STEP_COARSE } from "./paneModel.ts";
import type { KeyInput } from "./terminalKeys.ts";

/** Give one side the whole surface, or — when it already has it — put the
 * split back. The caller toggles; this map only says which side was asked
 * for. */
export type PaneKeyAction = { type: "solo"; side: PaneSide };

/** Resolves one keydown into a pane-host action, or `null` when this map has
 * nothing to say about the event. Never throws. */
export function resolvePaneKey(input: KeyInput): PaneKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a pane that
  // flickers open and shut is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  if (input.altKey !== true) return null;
  // Matched case-insensitively for the reason `columnKeys.ts` gives: a stuck
  // caps lock reports "B" for an unshifted chord, and losing the toggle to
  // caps lock would be a bug nobody would think to look for. ⌥ on macOS also
  // composes — ⌥b produces "∫", ⇧⌥b produces "ı" — so those readings are
  // accepted too.
  const key = input.key.toLowerCase();
  if (key !== "b" && key !== "∫" && key !== "ı") return null;
  // ⇧ is the mirror, not a modifier to be ignored: without it the terminal
  // takes the surface, with it the right pane does.
  return { side: input.shiftKey === true ? "right" : "left", type: "solo" };
}

export type DividerKeyAction =
  | { type: "nudge"; delta: number }
  | { type: "reset-ratio" }
  | { type: "solo"; side: PaneSide };

/** Resolves one keydown on the focused divider. Anything with the primary
 * modifier or ⌥ held falls through untouched — those chords belong to the maps
 * above, and a divider that swallowed them would make focusing it cost the
 * owner his other shortcuts. */
export function resolveDividerKey(input: KeyInput): DividerKeyAction | null {
  if (input.primaryModifier || input.altKey === true) return null;
  const step = input.shiftKey === true ? RATIO_STEP_COARSE : RATIO_STEP;
  if (input.key === "ArrowLeft") return { delta: -step, type: "nudge" };
  if (input.key === "ArrowRight") return { delta: step, type: "nudge" };
  // Home is the left pane at its smallest, which is gone — so the right pane
  // has the surface. End is the mirror. The divider is only ever rendered
  // inside a split, so neither of these can arrive as an un-toggle.
  if (input.key === "Home") return { side: "right", type: "solo" };
  if (input.key === "End") return { side: "left", type: "solo" };
  if (input.key === "0") return { type: "reset-ratio" };
  // Repeat is refused only for the discrete acts. Holding an arrow to slide
  // the divider is exactly what holding an arrow should do.
  if (input.repeat === true) return null;
  if (input.key === "Enter") return { side: "left", type: "solo" };
  return null;
}
