// **⌘W, taken back** (2026-08-29 redesign, P4.7, item 1; owner: "cmd w ye
// filan basinca tab kapanmali").
//
// For three releases this island wrote, in five headers, that ⌘W could never
// reach the webview: Tauri installs `Menu::default()` whenever the builder sets
// none, that menu carries `close_window` at ⌘W under both File and Window, and
// macOS resolves a menu key equivalent in `performKeyEquivalent:` before any
// keydown is delivered. Every word of that was true when it was written.
//
// **It is not true now, and the audit below is what found that out.**
// `desktop/src-tauri/src/app_menu.rs` builds this app's menu by hand —
// `Menu::default()` minus both `close_window` items, everything else matched
// item for item — and `lib.rs:315` installs it (`app_menu::install(builder)`).
// The File submenu held nothing else on macOS, so it is gone with the item; the
// Window submenu keeps Minimize and Maximize. No accelerator named ⌘W survives
// anywhere in that menu, so the keystroke is delivered to the webview like any
// other, and this map is what answers it.
//
// **What still closes the window**, since taking a chord away from a window is
// how an app becomes a trap: the red traffic-light button, ⌘M (Minimize, still
// in the Window submenu), ⌘H (Hide), and ⌘Q (Quit) — and the tray's "Open Buzz"
// is the way back from all of them. Note what the red button does *here*: this
// fork's `vingilot_window::apply_close_request` refuses the close and either
// dismisses what is stacked or minimizes into the Dock, deliberately, because
// hiding once lost the owner his window entirely (that module's header). So ⌘W
// never closed this window even while the menu owned it — the chord's whole
// journey is from "minimizes, eventually" to "closes the tab, then minimizes".
//
// **The six-claimant audit, re-run for this claim** (the idiom
// `useShellChords.ts` and `terminalKeys.ts` set — ⌘W is the chord that taught
// this codebase to run it, so it is run hardest here). Grepped 2026-08-31:
//
// 1. **The macOS application menu.** Not Tauri's default any more, but
//    `app_menu.rs`'s — read above. Its remaining accelerators are muda's
//    predefined ones (0.19.3 `items/predefined.rs:301-341`): ⌘C/X/V, ⌘Z, ⇧⌘Z,
//    ⌘A, ⌘M, ⌃⌘F, ⌘H, ⌥⌘H, ⌘Q. **⌘W is no longer among them**, which is the
//    whole premise of this file, and `cheatsheet.ts`'s `MENU_CHORDS` — the
//    build-time assertion that the island claims no menu chord — has been
//    corrected to match rather than left to fail quietly in the other
//    direction.
// 2. **Upstream's window-level handler** (`app/useAppShellKeyboardShortcuts.ts`)
//    — ⌘F, ⌘K, ⇧⌘K, ⇧⌘N, ⇧⌘O, ⇧⌘A, and nothing else; it returns early on ⌥ and
//    on `defaultPrevented`. No W of any kind. Its siblings: ⌘, (settings), ⌘±/⌘0
//    (zoom), ⌘R (reload), ⌘[ / ⌘] / ⌃⌘←→ (back-forward), Escape (mark as read).
//    None is W.
// 3. **Upstream's sidebar primitive** (`shared/ui/sidebar.tsx`) — ⌘S.
// 4. **This island's own maps** — `terminalKeys.ts` (⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌘D,
//    ⇧⌘D, ⌥⌘←→, ⌥⌘T, and P4.7's ⇧⌘\), `paletteKeys.ts` (⌘K/⌘P/⇧⌘P),
//    `paneKeys.ts` (⌥⌘B/⇧⌥⌘B), `columnKeys.ts` (⌘B), `cheatsheetKeys.ts` (⌘/),
//    `searchKeys.ts` (⇧⌘F), `scratchMarkdownKeys.ts` (⇧⌘M), `placeKeys.ts`
//    (⌃⇥), `diffKeys.ts` (j/k/⏎/⌥⏎), `dictationKeys.ts` (⌃⌘D). **⇧⌘W is the
//    only W in the island and it keeps its meaning**: it closes a terminal tab
//    with no reference to the stack, which is why it still works with the
//    palette open and ⌘W does not.
// 5. **TipTap's composer.** It claims ⌘B/⌘I/⌘U and friends at the element level
//    and `preventDefault`s what it takes; ⌘W is not one of them. It matters
//    anyway, and the guard is in `closeRequest.ts`'s host rather than here: a
//    caret in a text field must not lose the field's own ⌘W to a tab close.
// 6. **The two shields and Buzz Term's substrate.** `scratchTerminal.ts` and
//    `scratchMarkdownKeys.ts` re-read the island's maps to decide what an open
//    scratch surface swallows — neither resolves W, and both surfaces are
//    *above* the tab in the close order anyway, so ⌘W over them takes them
//    first. `features/terminal/terminalState.ts`'s `matchTabChord` DOES claim
//    ⌘W → close-tab, in a **capture-phase** window listener
//    (`TerminalSubstrate.tsx:335`) gated on `owner === "terminal"` — Buzz Term
//    mode, which is not this screen. It preventDefaults what it takes, and the
//    host of this map refuses a `defaultPrevented` event, so the two cannot
//    both fire even if a future layout put them on screen together.
//
// **What this map does NOT decide.** Only that the chord is ours. Which surface
// ⌘W takes — a dialog, else the palette, else the sheet, else a scratch, else
// the focused tab — is `closeRequest.ts`, and it is the same resolution the
// native close request has always used. One rule, two doors: that is the point
// of resolving the chord here instead of adding a second stack-walker beside
// the one that was already right.

import type { KeyInput } from "./terminalKeys.ts";

/** ⌘W's one action: take what is on top. `closeRequest.ts` says what that is
 * at the moment it is pressed. */
export type CloseKeyAction = { type: "close-top" };

/** Resolves one keydown into ⌘W, or `null` for everything else. Never throws;
 * a `KeyInput` with unexpected values resolves to `null`. */
export function resolveCloseKey(input: KeyInput): CloseKeyAction | null {
  // A held ⌘W would walk the whole stack in a quarter of a second — a dialog,
  // the palette, the sheet, a scratch shell and a terminal tab, all for one
  // lean on a key. Every other discrete map in this island refuses repeat for
  // a smaller reason than that.
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  // ⇧⌘W is `terminalKeys.ts`'s and means something narrower (close the terminal
  // tab, stack or no stack); ⌥⌘W is nobody's, and claiming it by accident would
  // take a chord this audit was never run for.
  if (input.shiftKey === true || input.altKey === true) return null;
  // Case-insensitive for the reason every letter chord here is: a stuck caps
  // lock reports "W" for the unshifted chord, and losing ⌘W to caps lock would
  // be a bug nobody would think to look for.
  return input.key.toLowerCase() === "w" ? { type: "close-top" } : null;
}
