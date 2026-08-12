// ⌃Tab, and the one key that calls it off
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 3).
//
// Same shape as `paletteKeys.ts`: two `resolve*` functions — one for the chord
// that starts the gesture, one for the keys that mean something only while it
// is running — so the map is unit-testable without React or a real keyboard,
// and the caller decides whether now is the time for it.
//
// **⌘Tab is not available and was never a candidate.** macOS's application
// switcher resolves it above every window, so a webview never sees the keydown;
// there is no `preventDefault` that reaches it. ⌃Tab is what VS Code binds for
// this gesture on macOS, Linux and Windows alike, so it is also the one the
// muscle memory this task exists for was trained on.
//
// **This is the one map in the island that reads a raw modifier.** Every other
// `resolve*` here takes `primaryModifier` — `hasPrimaryShortcutModifier`, which
// is ⌘ on macOS and Ctrl elsewhere — precisely so a chord means the same thing
// on both. That is the wrong instrument for this one: the chord is *named after
// Control*, and on macOS `hasPrimaryShortcutModifier` returns false for ⌃ while
// on Linux it returns true for it, so a map written against it would answer to
// ⌘Tab on the platform where ⌘Tab cannot arrive and to ⌃Tab on the platform
// where it can. Reading `ctrlKey` gives one chord on every platform, which is
// what VS Code has.
//
// **⌘ is refused below by what it is rather than by what the platform calls
// primary**, which is the other half of the same reading and the half that is
// easy to get backwards. Off-mac `hasPrimaryShortcutModifier` returns
// `event.ctrlKey && !event.metaKey` (`shared/lib/platform.ts`), so on Linux and
// Windows a real ⌃⇥ arrives *with* `primaryModifier` set — and a map that
// refused it there would refuse the very chord this file exists for on two of
// the three platforms `tauri.conf.json` builds for, while `cheatsheet()` went on
// printing ⌃⇥ under "The workspace" for a gesture that could not open. So the
// refusal is `metaKey`: ⌃⌘⇥ on macOS and ⌃-with-Super off it, a chord nobody
// here checked against the claimants, and it stays nobody's.
//
// **Every claimant checked, because ⌘W was lost this way once.**
//
// - **Tauri's default macOS application menu**, which this app installs by
//   setting none (tauri 2.11.5 app.rs:2245). muda 0.19.3
//   `items/predefined.rs:301-339` is the whole accelerator table: ⌘C/X/V, ⌘Z,
//   ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌘W, ⌘Q, ⌘H, ⌥⌘H, ⌃⌘F and Alt+F4. The only ⌃ chord in it
//   is ⌃⌘F, and it holds ⌘ as well. So ⌃⇥ reaches the webview.
// - **macOS itself.** ⌃⇥ is not a system shortcut; ⌘⇥ (apps) and ⌃↑/↓ (Mission
//   Control) are, and neither is this. Full Keyboard Access can bind ⌃F1…F7 —
//   again, not this.
// - **The browser engine.** WKWebView has no tab strip, so the Ctrl+Tab that
//   cycles tabs in a browser has nothing to cycle here; what remains of the
//   default action is sequential focus navigation, which `preventDefault` on
//   the keydown suppresses.
// - **Upstream's window-level handler** (app/AppShell.tsx) claims ⌘K, ⇧⌘K,
//   ⇧⌘N, ⇧⌘O and ⇧⌘A, all with the primary modifier and none on ⇥. Its sibling
//   maps: ⌘, (useSettingsShortcuts), ⌘±/⌘0 (useWebviewZoomShortcuts), ⌘R
//   (useReloadShortcut), ⌘[ / ⌘] and ⌃⌘←→ (useBackForwardControls — the only
//   other ⌃ chords in the app, both with ⌘ and both on arrows), ⌘F
//   (useChannelFind), plain Escape (useMarkAsReadShortcuts).
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⌥⌘T, ⌘K, ⌘/, ⌘B,
//   ⇧⌘B, ⌥⌘B, ⇧⌥⌘B, ⇧⌘F, ⌘F. None is ⇥ with ⌃.
// - **xterm, which is the one claimant that is not a map but a grab.**
//   @xterm/xterm 5.5.0's `common/input/Keyboard.ts` case 9 does not look at
//   `ctrlKey` at all: ⌃⇥ resolves to `C0.HT` with `cancel: true`, so a terminal
//   with focus writes a literal tab to the owner's shell and calls
//   `preventDefault()` + `stopPropagation()` on the event
//   (`browser/Terminal.ts` `_keyDown` → `cancel`). That listener is registered
//   on xterm's own textarea, and a window-capture listener runs before any
//   listener on any element — which is how `usePlaceSwitcher.ts` takes the
//   chord back. **The overlay wins over a focused terminal on purpose**:
//   switching places while the keyboard is in a shell is the single most likely
//   moment to want this gesture, and a switcher that worked everywhere except
//   the surface he spends the day in would not be the gesture he asked for. A
//   tab character in a shell is what he loses, and ⇥ with no ⌃ still sends one.

import type { KeyInput } from "./terminalKeys.ts";

/** Walk the list. `delta` is +1 for ⌃⇥ and -1 for ⇧⌃⇥ — a step through places
 * ordered most-recent-first, so +1 is "further back". */
export type PlaceKeyAction = { type: "step"; delta: number };

/** Resolves one keydown into a step through the recent places, or `null` when
 * this map has nothing to say. Never throws.
 *
 * Whether there is anywhere to step to, and whether some surface above the
 * workspace should have this key instead, are the caller's
 * (`usePlaceSwitcher.ts`) — resolving a key is not deciding to act on it. */
export function resolvePlaceKey(input: KeyInput): PlaceKeyAction | null {
  if (input.ctrlKey !== true) return null;
  // ⌥⌃⇥ and ⌃⌘⇥ are nobody's, and claiming either by ignoring its modifier
  // would take a chord the list above was never run for. Read as raw modifiers,
  // not through `primaryModifier` — see the header: off-mac that flag is
  // `ctrlKey` itself, so refusing it would refuse ⌃⇥.
  if (input.altKey === true) return null;
  if (input.metaKey === true) return null;
  if (input.key !== "Tab") return null;
  // **Repeat is allowed, and it is the only chord in this island where it is.**
  // Everywhere else a held chord is refused because each press is a discrete
  // act — ⌘T spawns a shell, ⌘K toggles a surface. Here the discrete act is
  // *releasing ⌃*, and a held ⇥ walking down the list is the whole of how an
  // alt-tab switcher is driven with the thumb still down.
  return { delta: input.shiftKey === true ? -1 : 1, type: "step" };
}

/** Give up the walk and go nowhere. */
export type PlaceListAction = { type: "cancel" };

/** Resolves one keydown made while the switcher is open.
 *
 * Esc only. There is nothing else to bind: the list is walked with the chord
 * that opened it and committed by letting go, so every other key belongs to
 * whatever is underneath — the owner is holding ⌃ over a terminal, and a map
 * that answered broadly here would swallow his shell's ⌃C.
 *
 * A held Esc is refused for the usual reason: the first one already closed the
 * surface, and the rest would be answering for a switcher that is not open.
 *
 * ⌘ is read raw here for the reason the header gives, and this map is where
 * getting it wrong bites hardest: the key arrives with ⌃ *held*, so off-mac
 * `primaryModifier` is true for every cancel there is and a refusal written
 * against it would be a cancel that never fires on Linux or Windows. */
export function resolvePlaceListKey(input: KeyInput): PlaceListAction | null {
  if (input.repeat === true) return null;
  if (input.metaKey === true || input.altKey === true) return null;
  return input.key === "Escape" ? { type: "cancel" } : null;
}
