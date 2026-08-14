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
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⌘B, ⌥⌘B,
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
//
// ----------------------------------------------------------------------------
// **⌘K is now app-wide, and ⌘P and ⇧⌘P join it**
// (vingilot/docs/plans/2026-08-12-an-ide-of-a-kind.md, Task 2)
// ----------------------------------------------------------------------------
//
// The scoping paragraph above described the split the owner filed a bug about:
// *"cmd k buzz kısmında farklı deck kısmında farklı çalışıyor."* ⌘K still opens
// this palette rather than upstream's dialog, and now it does so on every
// screen — because the palette's channel rows are **read from the store
// upstream's own switcher reads** (`features/channels/hooks.ts`'s
// `useChannelsQuery`), so nothing the owner reached for through ⌘K has been
// taken away; it is in the same list as his projects now. Upstream's dialog is
// not rewritten, not forked and not deleted: it still answers the sidebar's
// "Search everything" button, which is the surface for "which message said
// that", and this map does not touch ⇧⌘K.
//
// **The composer, re-checked — the one claimant the wider scope actually
// collides with.** The section above mitigated upstream's link editor
// (`features/messages/lib/useRichTextEditor.ts`) *by scope*: "It is on the
// channel screens, never on /workspace." Going app-wide put this palette on
// exactly those screens, so that sentence expired and the check had to be run
// again rather than inherited. It is a real collision, not a table entry:
// `usePalette.ts` binds `keydown` on `window` in the capture phase and stops
// propagation, which runs before the target phase and would keep the chord from
// ever reaching their handler.
//
// **Resolved by keeping upstream's own contract rather than by winning.** Their
// handler consumes ⌘K only when the shortcut applies — text selected, or the
// caret inside an existing link — and falls through to the app-wide binding
// otherwise, which their comment states in as many words. So the palette defers
// under that same condition and takes the chord in every other case, including
// a bare caret in a focused composer. `composerClaim.ts` is the whole of it,
// with the drift analysis; the seams entry for `app/routes/root.tsx` says the
// same thing to the next person reading the fork's footprint on upstream. Only
// ⌘K defers: nothing in the composer claims ⌘P or ⇧⌘P.
//
// **⌘P — the claimant check, run in full, because ⌘W and ⌥⌘M were both lost to
// claimants a reading could not see:**
//
// - **Tauri's default macOS menu**, muda 0.19.3 `items/predefined.rs:301-339`:
//   ⌘C/X/V, ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌘W, ⌘Q, ⌘H, ⌥⌘H, ⌃⌘F, Alt+F4. **There is no
//   Print item in that table**, which is the whole of why ⌘P is available here
//   and would not be in an app that installed a File menu.
// - **The AppKit-synthesis rule** (`scratchMarkdownKeys.ts`'s header): macOS
//   synthesizes ⌥-variants of *Window-menu* items at runtime. ⌘P and ⇧⌘P are
//   neither ⌥-variants nor Window-menu items — the Window menu is Minimize,
//   Zoom and Bring All to Front — so the rule does not reach them.
// - **Upstream's window handler** (`app/AppShell.tsx`): ⌘K, ⇧⌘K, ⇧⌘N, ⇧⌘O,
//   ⇧⌘A. Neither ⌘P nor ⇧⌘P. Its other maps — `useSettingsShortcuts` (⌘,),
//   `useWebviewZoomShortcuts` (⌘± ⌘0), `useReloadShortcut` (⌘R),
//   `useBackForwardControls` (⌘[ ⌘]) — hold no P either.
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⌥⌘T, ⇧⌘W, ⌥⌘←→, ⌘B, ⌥⌘B,
//   ⇧⌥⌘B, ⌘K, ⌘/, ⇧⌘F, ⇧⌘M, ⌃⇥. None is on P.
// - **The empirical half cannot be run from here** — that needs the app
//   launched, which agents do not do. What stands in for it is `preventDefault`
//   on the resolved chord, which is also what keeps a browser's own Print
//   dialog out of the E2E run, and a Playwright spec that presses the chord in
//   a real document and reads the palette that appears.
//
// **⇧⌘P rather than ⌥⌘P for the commands door.** ⌥+letter is the corner the
// synthesis rule makes unsafe, and ⇧⌘P is VS Code's own spelling of this door
// on every platform — the muscle memory is the point of the whole task.

import type { PaletteDoor } from "./paletteDoors.ts";
import type { KeyInput } from "./terminalKeys.ts";

/** Open the palette on a door, or — when it is already open on that same door
 * — put it away. One chord for both, because a key that opens a surface and
 * then does nothing is a key the owner presses twice looking for the way out.
 *
 * The door is carried rather than three action types, because it is one act
 * with a parameter: `usePalette.ts` switches doors on a palette that is already
 * open rather than closing and reopening it, which is what makes ⌘P from an
 * open ⌘K a change of list and not a flicker. */
export type PaletteKeyAction = { type: "toggle-palette"; door: PaletteDoor };

/** Resolves one keydown into "the owner asked for a door of the palette", or
 * `null` when this map has nothing to say. Never throws. */
export function resolvePaletteKey(input: KeyInput): PaletteKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a palette that
  // opened and shut fifteen times a second is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥⌘K and ⌥⌘P are nobody's here, and claiming either by ignoring ⌥ would take
  // a chord this map never checked against the claimants above.
  if (input.altKey === true) return null;
  // Matched case-insensitively for the reason `columnKeys.ts` gives: a stuck
  // caps lock reports "K" for the unshifted chord, and losing the palette to
  // caps lock would be a bug nobody would think to look for.
  const key = input.key.toLowerCase();
  if (key === "k") {
    // ⇧⌘K is upstream's new-direct-message, and it is bound on every screen.
    // Ignoring ⇧ would swallow it.
    return input.shiftKey === true
      ? null
      : { door: "go", type: "toggle-palette" };
  }
  if (key === "p") {
    return {
      door: input.shiftKey === true ? "commands" : "files",
      type: "toggle-palette",
    };
  }
  return null;
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
