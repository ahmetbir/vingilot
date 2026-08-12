// ⇧⌘F — the chord the whole task is named after
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 2).
//
// > *"bugün işte ne için vscode açtım biliyor musun. projede cmd shift f yapıp
// > bir şey bulmak için."*
//
// Same shape as `cheatsheetKeys.ts`, `paletteKeys.ts` and `columnKeys.ts`: a
// `resolve*` function, so the map is unit-testable without React or a keyboard,
// and so `cheatsheet.ts` can *generate* the row for it rather than have one
// written down. A chord in a component's own `onKeyDown` is a chord the sheet
// cannot print.
//
// **Every claimant was checked before taking it** — the same four-claimant check
// `cheatsheetKeys.ts` documents, run again, because ⌘W was lost to an unchecked
// claimant once and the loss was silent:
//
// - **Tauri's default macOS application menu**, which this app installs by
//   setting none. Its accelerators are muda 0.19.3 src/items/predefined.rs in
//   full: ⌘C, ⌘X, ⌘V, ⌘Z, ⇧⌘Z, ⌘A, ⌘M, ⌃⌘F, ⌘H, ⌥⌘H, ⌘W and ⌘Q. **`⌃⌘F` is on
//   that list and it is not this chord**: full screen is *control*-⌘F, and
//   nothing in the table is on ⇧. This is the one claimant that comes close,
//   which is exactly why it is named here rather than skipped.
// - **The app's global shortcut**: ⌃Space for push-to-talk
//   (`src-tauri/src/ptt_shortcut.rs:27`). Not this key.
// - **Upstream's own handlers.** `features/search/useChannelFind.ts:139-154`
//   binds the platform find chord on this letter — and it takes **⌘F**, with
//   `!event.shiftKey` in its own guard, so ⇧⌘F reaches nothing there. That
//   guard is what makes this chord free: find-in-this-channel and
//   search-the-checkout are two different things and they now have two
//   different chords, which is also what VS Code does and what he has in his
//   fingers. `app/AppShell.tsx:630-673` binds ⌘K, ⇧⌘K, ⇧⌘N, ⇧⌘O and ⇧⌘A —
//   letters, none of them F. `useReloadShortcut` (⌘R), `useSettingsShortcuts`
//   (⌘,), `useWebviewZoomShortcuts` (⌘+/-/0) and `useBackForwardControls`
//   (⌘[ / ⌘]) all return early on ⇧ or are on other keys. A grep of the whole
//   of desktop/src for a handler comparing `key` against "f" returns exactly
//   one hit, `useChannelFind`'s, and it is the one above.
// - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⇧⌥⌘←→, ⌥⌘T
//   (terminalKeys), ⌘B / ⇧⌘B (columnKeys), ⌥⌘B / ⇧⌥⌘B (paneKeys), ⌘K
//   (paletteKeys), ⌘/ (cheatsheetKeys), `j`/`k`/↵ (diffKeys). None is on F.
//
// **⇧ is required rather than tolerated**, which is the opposite of what ⌘/
// does and for a reason: there, ⇧ is an artefact of the owner's Turkish-Q
// layout, where "/" is ⇧7. Here ⇧ is the chord. Accepting a bare ⌘F would take
// the chord upstream binds for find-in-channel, which is a working feature on
// every other screen in this app.

import type { KeyInput } from "./terminalKeys.ts";

/** Put the search surface on screen. **Not a toggle**, unlike ⌘/ and ⌘K: the
 * two of those open something *over* the workspace, and a key that opens an
 * overlay and then does nothing is a key the owner presses twice looking for
 * the way out. This one chooses a pane, and a chord that put the pane away
 * again would take the results he just asked for off the screen the moment he
 * pressed it a second time out of habit. Pressing it while the pane is up
 * re-focuses the field, which is the gesture he actually means. */
export type SearchKeyAction = { type: "open-search" };

/** Resolves one keydown into "find something in this checkout", or `null` when
 * this map has nothing to say. Never throws. */
export function resolveSearchKey(input: KeyInput): SearchKeyAction | null {
  // A held-down chord delivers 15-30 keydowns a second. Nothing here is
  // destructive, but re-focusing a field thirty times a second while he holds
  // the key is a field he cannot type into.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⌥⇧⌘F is nobody's here, and claiming it by ignoring ⌥ would take a chord
  // this map never checked against the claimants above.
  if (input.altKey === true) return null;
  // See the header: without ⇧ this is upstream's find-in-this-channel.
  if (input.shiftKey !== true) return null;
  // Lower-cased because a caps-locked keyboard reports "F", and the chord he
  // pressed is the same chord.
  return input.key.toLowerCase() === "f" ? { type: "open-search" } : null;
}
