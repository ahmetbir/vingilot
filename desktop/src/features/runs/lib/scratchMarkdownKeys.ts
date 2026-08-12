// ⇧⌘M — the scratch markdown buffer's chord, and what an open buffer shields
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// **This chord was ⌥⌘M for one day, and the owner's fingers found the claimant
// the audit missed.** The four-claimant check below read muda's accelerator
// table and found ⌘M holding Minimize and ⌥⌘M holding nothing — which is true
// of the *table* and false of the *machine*: macOS synthesizes a "Minimize All"
// key equivalent at ⌥⌘M at runtime for any window menu that carries a Minimize
// item. AppKit resolves menu key equivalents before the webview sees a keydown,
// so the chord minimized every window and the buffer never heard about it. The
// lesson joins the check: **a static accelerator table is not the OS's last
// word — AppKit synthesizes ⌥-variants for Window-menu items**, so no chord of
// this island may sit on ⌥+letter where ⌘+letter is a Window-menu item.
//
// **So: ⇧⌘M.** Still M for markdown, still one hand shape away from the scratch
// shell's ⌥⌘T — the sibling reading survives, with ⇧ as the "variant of"
// modifier this time because ⌥ is spoken for by the OS itself. macOS synthesizes
// no ⇧-variants for menu items, which is the property that makes this corner
// safe where the last one was not.
//
// **Every claimant checked, because ⌘W was lost this way once and ⌥⌘M twice:**
//
// - **Tauri's default macOS menu**, muda 0.19.3 `items/predefined.rs:301-339`:
//   ⌘C/X/V, ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌃⌘F, ⌘H, ⌥⌘H, ⌘W, Alt+F4, ⌘Q. ⇧⌘M is not in
//   it, and — the new rule — it is not an ⌥-variant AppKit would synthesize.
//   The only ⇧ chord in the table is ⇧⌘Z (redo), nowhere near M.
// - **Upstream's window handler** (`app/AppShell.tsx`): claims ⌘K, ⇧⌘K, ⇧⌘N,
//   ⇧⌘O, ⇧⌘A — ⇧ chords, none on M.
// - **The app's other global maps**: ⌘, / ⌘±/⌘0 / ⌘R / ⌘[ ⌘] ⌃⌘←→ / ⌘F /
//   Escape. None is ⇧⌘M.
// - **This island's own maps**: ⇧⌘W and ⇧⌘F are the island's other ⇧⌘ chords
//   (`terminalKeys.ts`, `searchKeys.ts`); ⇧⌘B (`columnKeys.ts`) is the third.
//   None is on M.
//
// ⌥ is refused below the way ⇧ was refused before, and for the sharper reason
// now: ⌥⌘M *is* somebody's — the OS's — and a map that also answered to it
// would disagree with the machine about what the chord did.
//
// Pure: no React, no Tauri, no storage — the same `resolve*` shape as every
// other key map in this island, so it can be driven by a plain object literal
// and so `cheatsheet.ts` can generate its row from the map itself.

import { resolveColumnKey } from "./columnKeys.ts";
import { resolvePaneKey } from "./paneKeys.ts";
import { type KeyInput, resolveKey } from "./terminalKeys.ts";

export type ScratchMarkdownKeyAction = { type: "open-scratch-markdown" };

/** Resolves ⇧⌘M, or `null` for anything else. */
export function resolveScratchMarkdownKey(
  input: KeyInput,
): ScratchMarkdownKeyAction | null {
  // Auto-repeat is not a second press: this chord is a toggle, and a leaned-on
  // key would flicker the buffer open and shut fifteen times a second. The same
  // guard every discrete chord in this island opens with.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  if (input.shiftKey !== true) return null;
  // ⌥ is the OS's here — ⌥⌘M is the synthesized Minimize All (see the header) —
  // so ⇧⌥⌘M is refused rather than absorbed: a chord the menu may also act on
  // must not half-belong to this map.
  if (input.altKey === true) return null;
  // ⇧m reports "M"; toLowerCase folds it, and a stuck caps lock (which reports
  // "m" with ⇧ held) folds to the same place. No composed character to accept:
  // ⇧ does not compose the way ⌥ does.
  if (input.key.toLowerCase() !== "m") return null;
  return { type: "open-scratch-markdown" };
}

/** What a keydown means while the buffer is open.
 *
 * `shield` is "the surface underneath must not act on this", and the argument is
 * `scratchTerminal.ts`'s `resolveScratchKey` verbatim: while a modal is over the
 * work surface, ⇧⌘W closing a terminal tab, ⌘T stealing focus into a terminal he
 * cannot see, or ⌥⌘B rearranging the panes behind it are all acts on something
 * that is not in front of him.
 *
 * **Shielded, not swallowed wholesale.** Only the chords the surfaces underneath
 * actually resolve are stopped, so the app's own global keys — zoom, settings,
 * reload — still work, and, far more importantly here, so do ⌘A, ⌘C, ⌘V and ⌘Z,
 * which are the default menu's and are the keys a text editor is *made of*.
 *
 * **Escape closes, and this is the one place the two scratches differ.** A
 * terminal owns Escape — vim, less, every reader — so the shell shields it and
 * says so. A textarea does not: Escape in one does nothing at all, and every
 * modal editor the owner has ever used closes on it. Making him reach for the
 * chord to leave a text box would be a difference for its own sake. */
export type ScratchMarkdownShield = { type: "close" } | { type: "shield" };

export function resolveScratchMarkdownShield(
  input: KeyInput,
): ScratchMarkdownShield | null {
  // The same chord both ways: a key that opens a surface and then does nothing
  // is a key the owner presses twice looking for the way out.
  if (resolveScratchMarkdownKey(input) !== null) return { type: "close" };
  const surface = resolveKey(input);
  // `leave-terminal` *is* plain Escape (`terminalKeys.ts`). Read through that
  // map rather than by comparing `input.key` so the day Escape means something
  // else there, this reads whatever it means then.
  if (surface?.type === "leave-terminal") return { type: "close" };
  if (surface !== null) return { type: "shield" };
  if (resolvePaneKey(input) !== null) return { type: "shield" };
  if (resolveColumnKey(input) !== null) return { type: "shield" };
  return null;
}
