// Pure keyboard-resolution for the cheatsheet — the key that puts every other
// key on screen (vingilot/docs/plans/2026-08-09-keys-and-type.md, Task 4). Same
// shape as `terminalKeys.ts`, `columnKeys.ts`, `paneKeys.ts` and
// `paletteKeys.ts`: a `resolve*` function so the map is unit-testable without
// React or a real keyboard, and the caller decides whether now is the time.
//
// **⌘/ is the convention, and every claimant was checked before taking it** —
// the same four-claimant check `columnKeys.ts` documents, run again, because
// ⌘W was lost to an unchecked claimant once and the loss was silent:
//
// - **Tauri's default macOS application menu**, which this app installs by
//   setting none (tauri 2.11.5 src/app.rs:2243-2249; `lib.rs` calls neither
//   `.menu(…)` nor `.enable_macos_default_menu(false)`, which
//   `vingilot_window`'s `lib_rs_leaves_the_default_macos_menu_alone` fails the
//   build over). Its accelerators are muda 0.19.3
//   src/items/predefined.rs:301-341 in full: ⌘C, ⌘X, ⌘V, ⌘Z, ⇧⌘Z, ⌘A, ⌘M,
//   ⌃⌘F, ⌘H, ⌥⌘H, ⌘W and ⌘Q. `Code::Slash` appears nowhere in that table (it
//   exists in muda's accelerator parser, src/accelerator.rs:200 and :313, and
//   no predefined item asks for it), and tauri's own `menu/menu.rs` sets no
//   accelerator of its own. So unlike ⌘W, this chord reaches the webview.
// - **The app's global shortcut**, the only chord this app registers outside a
//   window: ⌃Space for push-to-talk (`src-tauri/src/ptt_shortcut.rs:27`).
// - **Upstream's window-level handler** (app/AppShell.tsx:629-673): ⌘K, ⇧⌘K,
//   ⇧⌘N, ⇧⌘O, ⇧⌘A — letters only, and it returns immediately on ⌥. Plus ⌘,
//   (useSettingsShortcuts), ⌘R (useReloadShortcut), ⌘[ / ⌘] / ⌃⌘←→
//   (useBackForwardControls), ⌘+ / ⌘- / ⌘0 (useWebviewZoomShortcuts), ⌘F
//   (useChannelFind), plain Escape (useMarkAsReadShortcuts), ⌘S (the sidebar
//   primitive, shared/ui/sidebar.tsx:39), and the composer's own ⌘K/⌘A/⌘E
//   (useRichTextEditor.ts). A grep of the whole of desktop/src for a handler
//   comparing `key`/`code` against "/", "?" or "Slash" returns nothing, and
//   upstream's own shortcut registry (shared/lib/keyboard-shortcuts.ts, what
//   settings prints) lists no chord on this key either.
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⇧⌥⌘←→, ⌥⌘T
//   (terminalKeys), ⌘B (columnKeys; ⇧⌘B retired), ⌥⌘B / ⇧⌥⌘B (paneKeys), ⌘K
//   (paletteKeys), `j`/`k`/↵ (diffKeys). None is on this key.
//
// **⇧ is tolerated rather than ignored, and that is about the owner's own
// keyboard.** On a US layout "/" is unshifted and ⌘/ arrives with `shiftKey`
// false. On the Turkish-Q layout he types on, "/" is ⇧7 — so the same chord
// arrives with `shiftKey` true and `key` still "/". Refusing ⇧ here would mean
// the sheet had no chord on his machine, which is the one machine it is for.
// What is *not* accepted is "?" — the character a US layout reports for ⇧⌘/.
// Nobody reaches for ⇧⌘/ on a layout where ⌘/ is one key press, and accepting
// it would put a second chord on the sheet (`⌘?`) that nothing can actually
// press: the shift the fold removes is the shift that produced the character.

import type { KeyInput } from "./terminalKeys.ts";

/** Show the sheet, or — when it is already up — put it away. One chord for
 * both, for the reason `paletteKeys.ts` gives: a key that opens a surface and
 * then does nothing is a key the owner presses twice looking for the way out. */
export type CheatsheetKeyAction = { type: "toggle-cheatsheet" };

/** Resolves one keydown into "the owner asked what the keys are", or `null`
 * when this map has nothing to say. Never throws. */
export function resolveCheatsheetKey(
  input: KeyInput,
): CheatsheetKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second, and a sheet that
  // opened and shut fifteen times a second is not a second press of anything.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥⌘/ is nobody's here, and claiming it by ignoring ⌥ would take a chord
  // this map never checked against the claimants above.
  if (input.altKey === true) return null;
  return input.key === "/" ? { type: "toggle-cheatsheet" } : null;
}

/** The one key the sheet answers to while it is up. */
export type OpenCheatsheetKeyAction = { type: "close-cheatsheet" };

/** Resolves one keydown made while the sheet is on screen. Esc and nothing
 * else: this surface has no cursor to move and nothing to type into, so every
 * other key is one the owner meant for what is underneath — and the caller
 * keeps those from arriving there by other means (`ui/KeyCheatsheet.tsx`),
 * which is a decision about propagation rather than about meaning.
 *
 * Anything with a modifier held falls through untouched, so the ⌘/ that opened
 * this still closes it and ⌘K still reaches the palette. */
export function resolveOpenCheatsheetKey(
  input: KeyInput,
): OpenCheatsheetKeyAction | null {
  if (input.primaryModifier || input.altKey === true) return null;
  if (input.repeat === true) return null;
  return input.key === "Escape" ? { type: "close-cheatsheet" } : null;
}
