// ⌥⌘M — the scratch markdown buffer's chord, and what an open buffer shields
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// **Why ⌥⌘M, and why it is a sibling rather than a cousin.** The scratch shell
// is ⌥⌘T (`terminalKeys.ts`): ⌥ is this island's "variant of" modifier, and T is
// the letter of the thing — a Terminal, one modifier away from the ⌘T that opens
// one that keeps everything. The markdown buffer is the same gesture with the
// letter of *its* thing: **M for markdown**, on the same ⌥⌘ prefix, one key to
// the left of T on the same row of the keyboard. Pressed by the same hand shape.
// That is the whole of the choice — the two scratches are one gesture with a
// letter swapped, which is what "siblings" has to mean at the fingers rather
// than in a design document.
//
// **Every claimant checked, because ⌘W was lost this way once.** The check is
// `terminalKeys.ts`'s, re-run for this key rather than assumed from that one:
//
// - **Tauri's default macOS menu**, which this app installs by setting none.
//   muda 0.19.3 `items/predefined.rs:301-339` is the whole accelerator table —
//   ⌘C/X/V, ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌃⌘F, ⌘H, ⌥⌘H, ⌘W, Alt+F4, ⌘Q — and it is
//   `cheatsheet.ts`'s `MENU_CHORDS`, which a test asserts the island never
//   collides with. **⌘M is in it and ⌥⌘M is not**: the table holds
//   `PredefinedMenuItem::minimize` at ⌘M and has no "minimize all". The only ⌥
//   chord in the whole table is ⌥⌘H, exactly as it was for ⌥⌘T.
// - **Upstream's window handler** (`app/AppShell.tsx`): returns immediately on
//   `event.altKey`, so it claims no ⌥ chord at all.
// - **The app's other global maps**: ⌘, (`useSettingsShortcuts`), ⌘±/⌘0
//   (`useWebviewZoomShortcuts`, which also returns on ⌥), ⌘R
//   (`useReloadShortcut`), ⌘[ / ⌘] / ⌃⌘←→ (`useBackForwardControls`), ⌘F
//   (`useChannelFind`), plain Escape (`useMarkAsReadShortcuts`). None is ⌥⌘M.
// - **This island's own maps**: ⌥⌘T and ⌥⌘←→ (`terminalKeys.ts`), ⌥⌘B / ⇧⌥⌘B
//   (`paneKeys.ts`, which resolves only "b"/"∫"/"ı"), ⌘K (`paletteKeys.ts`,
//   which returns on ⌥), ⌘B/⇧⌘B (`columnKeys.ts`, which returns on ⌥), ⌘/
//   (`cheatsheetKeys.ts`), ⇧⌘F (`searchKeys.ts`), ⌘F (`findKeys.ts`), ⌃⇥
//   (`placeKeys.ts`, which refuses ⌥ explicitly). None is on M at all.
//
// ⇧ is not ignored, for `terminalKeys.ts`'s reason: ⇧⌥⌘M is nobody's, and
// claiming it by accident would take a chord this check was never run for.
//
// Pure: no React, no Tauri, no storage — the same `resolve*` shape as every
// other key map in this island, so it can be driven by a plain object literal
// and so `cheatsheet.ts` can generate its row from the map itself.

import { resolveColumnKey } from "./columnKeys.ts";
import { resolvePaneKey } from "./paneKeys.ts";
import { type KeyInput, resolveKey } from "./terminalKeys.ts";

export type ScratchMarkdownKeyAction = { type: "open-scratch-markdown" };

/** Resolves ⌥⌘M, or `null` for anything else. */
export function resolveScratchMarkdownKey(
  input: KeyInput,
): ScratchMarkdownKeyAction | null {
  // Auto-repeat is not a second press: this chord is a toggle, and a leaned-on
  // key would flicker the buffer open and shut fifteen times a second. The same
  // guard every discrete chord in this island opens with.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  if (input.altKey !== true) return null;
  if (input.shiftKey === true) return null;
  // "µ" is what macOS reports for ⌥m while the ⌥ composition still applies —
  // the same reading `terminalKeys.ts` accepts "†" for and `paneKeys.ts`
  // accepts "∫" for. Caps lock reports "M" for the unshifted chord, and losing
  // this to caps lock would be a bug nobody would think to look for.
  const key = input.key.toLowerCase();
  if (key !== "m" && key !== "µ") return null;
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
