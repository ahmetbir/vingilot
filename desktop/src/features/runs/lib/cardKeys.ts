// Pure keyboard-resolution for a pinned card in the deck: ← and → move the
// focused card along the row. Same shape as `terminalKeys.ts` — a `resolve*`
// function, so the map is unit-testable without React or a real keyboard, and
// the caller decides whether now is the time for it.
//
// **This is a module because of the cheatsheet.** The two keys lived in
// `PinnedCard.tsx`'s own `onKeyDown`, which works and is invisible:
// `cheatsheet.ts` builds its rows by asking every map in its `KEY_MAPS` what it
// answers to, so a chord bound inside a component is a chord the sheet cannot
// print — while the sheet opens by claiming it carries every chord this
// workspace binds. Moving the binding here is what makes that claim structural
// rather than remembered.
//
// **Modifiers are read and not required**, which is exactly what the handler
// this replaced did: ← is ← whatever else is held down. The sheet folds the
// modified readings back onto the bare chord, so it still prints ← and → and
// not eight of each.
//
// These keys are resolved only from a card's own key handler, never from the
// window — an unmodified arrow belongs to whatever has focus, and a global one
// would fight the divider, the palette list and every text field in the app.

import type { KeyInput } from "./terminalKeys.ts";

/** Move this card one place along the deck. `dir` is -1 for left, 1 for
 * right — the same convention `terminalKeys.ts` uses for tab moves. */
export type CardKeyAction = { type: "move-card"; dir: -1 | 1 };

/** Resolves one keydown on a focused card into a move, or `null` when this map
 * has nothing to say about the key. Never throws.
 *
 * Whether the card can be moved at all — an unplaced card has no place in the
 * row to move along — stays with the caller, for the reason every map here
 * gives: resolving a key is not deciding to act on it. */
export function resolveCardKey(input: KeyInput): CardKeyAction | null {
  if (input.key === "ArrowLeft") return { dir: -1, type: "move-card" };
  if (input.key === "ArrowRight") return { dir: 1, type: "move-card" };
  return null;
}
