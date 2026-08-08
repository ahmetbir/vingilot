// Pure keyboard-resolution for the command palette — the key that opens it,
// and the keys that drive it once it is open. Same shape as `terminalKeys.ts`,
// `columnKeys.ts` and `paneKeys.ts`: a `resolve*` function so the map is
// unit-testable without React or a real keyboard, and the caller decides
// whether now is the time for it.
//
// **⌘K is already bound in this app, and this map takes it on /workspace.**
// The four-claimant check `columnKeys.ts` documents, run again for this chord:
//
// - **Tauri's default macOS application menu**, which this app installs by
//   setting none (tauri 2.11.5 app.rs:2245). Its predefined items claim
//   ⌘C/X/V, ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌘W, ⌘Q, ⌘H, ⌥⌘H, ⌃⌘F and Alt+F4, and nothing
//   else — muda 0.19.3 items/predefined.rs:301-339 is the whole list, and
//   `KeyK` is not in it. `tauri-2.11.5/src/menu/menu.rs` (400 lines) sets no
//   accelerator of its own. So unlike ⌘W, this chord does reach the webview.
// - **Upstream's window-level handler** (app/AppShell.tsx:629-673). It claims
//   ⌘K for the community search dialog (`features/search/ui/TopbarSearch.tsx`
//   — the sidebar's "Search everything ⌘K" button), and ⇧⌘K for a new direct
//   message. **This is a live binding, not a label**: the listener is bound in
//   a layout effect on every screen except /settings, so ⌘K on /workspace
//   opens a relay message search over a workspace it knows nothing about.
// - **Upstream's composer** (features/messages/lib/useRichTextEditor.ts:546),
//   which claims ⌘K at the element level for the link editor. It is on the
//   channel screens, never on /workspace.
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⌘B, ⇧⌘B, ⌥⌘B,
//   ⇧⌥⌘B. None is ⌘K.
//
// **Taking it rather than extending it or picking a third key.** The search
// dialog answers "which message said that" against a relay; the palette
// answers "which project, which worktree, which pane, which action" against a
// workspace on this machine. They share a shape and nothing else, and the two
// stores are not reachable from one another — extending upstream's dialog
// would mean editing three upstream files to teach a relay search about
// worktrees. A third key would leave the muscle memory the owner asked for
// (*"⌘K ile hızlı bir şeyler arama"*) pointing at the wrong surface on the one
// screen this fork exists for.
//
// **Nothing is taken away.** The claim is scoped to /workspace, where the
// island's own screen is mounted; every other screen keeps upstream's search
// on ⌘K. And the sidebar's "Search everything" button is on /workspace too and
// still opens it with a click — this map redirects a key, it does not remove a
// surface.
//
// How the claim is enforced is `usePalette.ts`'s, and it uses upstream's own
// deference path: AppShell's handler returns early on `event.defaultPrevented`
// for exactly this case ("a focused surface may claim the shortcut first").

import type { KeyInput } from "./terminalKeys.ts";

/** Open the palette, or — when it is already open — put it away. One chord for
 * both, because a key that opens a surface and then does nothing is a key the
 * owner presses twice looking for the way out. */
export type PaletteKeyAction = { type: "toggle-palette" };

/** Resolves one keydown into "the owner asked for the palette", or `null` when
 * this map has nothing to say. Never throws. */
export function resolvePaletteKey(input: KeyInput): PaletteKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a palette that
  // opened and shut fifteen times a second is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥⌘K is nobody's here, and claiming it by ignoring ⌥ would take a chord
  // this map never checked against the four claimants above.
  if (input.altKey === true) return null;
  // ⇧⌘K is upstream's new-direct-message, and it is bound on this screen too.
  // Ignoring ⇧ would swallow it.
  if (input.shiftKey === true) return null;
  // Matched case-insensitively for the reason `columnKeys.ts` gives: a stuck
  // caps lock reports "K" for the unshifted chord, and losing the palette to
  // caps lock would be a bug nobody would think to look for.
  return input.key.toLowerCase() === "k" ? { type: "toggle-palette" } : null;
}

export type PaletteListAction =
  | { type: "close" }
  | { type: "move"; delta: number }
  | { type: "refocus" }
  | { type: "run" };

/** Resolves one keydown made while the palette is open — wherever focus is.
 * The caller binds this over the whole window, not over the field: a blocked
 * row is clickable on purpose and keeps the focus the click gave it, and a map
 * that only answered for the field would leave Esc dead in a state the design
 * itself produces.
 *
 * Anything with the primary modifier or ⌥ held falls through untouched: those
 * chords belong to the maps above, and ⌘K in particular has to reach
 * `resolvePaletteKey` so the same key that opened this can close it. Plain
 * text keys fall through too — they are what the owner is typing. */
export function resolvePaletteListKey(
  input: KeyInput,
): PaletteListAction | null {
  if (input.primaryModifier || input.altKey === true) return null;
  // Repeat is allowed here and refused below: holding ↓ to run down a list is
  // exactly what holding ↓ should do, while a held Enter would run the same
  // action thirty times.
  if (input.key === "ArrowDown") return { delta: 1, type: "move" };
  if (input.key === "ArrowUp") return { delta: -1, type: "move" };
  // Tab belongs to the palette, and all it does is come back. This surface is
  // one field and a list walked with the arrows, so there is nothing here to
  // tab *to* — while a Tab that left put focus on controls the scrim is drawn
  // over, where a later Space or Enter would press a button the owner cannot
  // see. Resolved before the repeat guard because a held Tab moves focus on
  // every repeat, and ⇧⇥ is the same answer as ⇥ for the same reason.
  if (input.key === "Tab") return { type: "refocus" };
  if (input.repeat === true) return null;
  if (input.key === "Escape") return { type: "close" };
  // ⇧↵ is not a second Enter. Nothing here binds it, and resolving it as one
  // would run an action the owner was reaching past.
  if (input.key === "Enter" && input.shiftKey !== true) return { type: "run" };
  return null;
}
