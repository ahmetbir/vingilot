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
// **The divider's keys are the reason the divider exists in this file at
// all.** A splitter that only answers a drag is not reachable for someone
// working from the keyboard, and "resize the terminal" is not a niche act in
// an app whose main surface is a terminal. The bindings follow the WAI-ARIA
// window-splitter pattern — arrows move it, Home/End take it to its limits,
// Enter collapses and restores — with `0` for the reset that a mouse gets by
// double-clicking, chosen to rhyme with the ⌘0 that resets zoom.
//
// These keys are resolved only from the divider's own handler, never from the
// window: unmodified arrows belong to whatever has focus, and a global arrow
// binding would move the split while the owner was moving a cursor.

import {
  RATIO_STEP,
  RATIO_STEP_COARSE,
  MAX_RATIO,
  MIN_RATIO,
} from "./paneModel.ts";
import type { KeyInput } from "./terminalKeys.ts";

export type PaneKeyAction = { type: "toggle-right-pane" };

/** Resolves one keydown into a pane-host action, or `null` when this map has
 * nothing to say about the event. Never throws. */
export function resolvePaneKey(input: KeyInput): PaneKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a pane that
  // flickers open and shut is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  if (input.altKey !== true) return null;
  // ⇧⌥⌘B is nobody's yet; claiming it here by ignoring ⇧ would take it.
  if (input.shiftKey === true) return null;
  // Matched case-insensitively for the reason `columnKeys.ts` gives: a stuck
  // caps lock reports "B" for an unshifted chord, and losing the toggle to
  // caps lock would be a bug nobody would think to look for. ⌥ on macOS also
  // composes — ⌥b produces "∫" — so both readings are accepted.
  const key = input.key.toLowerCase();
  if (key !== "b" && key !== "∫") return null;
  return { type: "toggle-right-pane" };
}

export type DividerKeyAction =
  | { type: "nudge"; delta: number }
  | { type: "set-ratio"; ratio: number }
  | { type: "reset-ratio" }
  | { type: "toggle-right-pane" };

/** Resolves one keydown on the focused divider. Anything with the primary
 * modifier or ⌥ held falls through untouched — those chords belong to the maps
 * above, and a divider that swallowed them would make focusing it cost the
 * owner his other shortcuts. */
export function resolveDividerKey(input: KeyInput): DividerKeyAction | null {
  if (input.primaryModifier || input.altKey === true) return null;
  const step = input.shiftKey === true ? RATIO_STEP_COARSE : RATIO_STEP;
  if (input.key === "ArrowLeft") return { delta: -step, type: "nudge" };
  if (input.key === "ArrowRight") return { delta: step, type: "nudge" };
  if (input.key === "Home") return { ratio: MIN_RATIO, type: "set-ratio" };
  if (input.key === "End") return { ratio: MAX_RATIO, type: "set-ratio" };
  if (input.key === "0") return { type: "reset-ratio" };
  // Repeat is refused only for the discrete acts. Holding an arrow to slide
  // the divider is exactly what holding an arrow should do.
  if (input.repeat === true) return null;
  if (input.key === "Enter") return { type: "toggle-right-pane" };
  return null;
}
