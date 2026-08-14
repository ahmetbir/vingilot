// ⌃⌘D — the dictation chord, and the six-claimant audit that clears it
// (vingilot/docs/plans/2026-08-13-voice.md, Task 3; the discipline is
// `scratchMarkdownKeys.ts`'s header, including the AppKit ⌥-synthesis rule).
//
// **⌘D and ⇧⌘D are already spoken for in this island** — `terminalKeys.ts`
// deliberately leaves them unbound for iTerm's split-vertical/horizontal, and
// its header is explicit that the one thing ⌘D could honestly claim
// (aliasing to `new-terminal-tab`) is refused. A dictation chord therefore
// needed a third modifier, not a reused one, and ⌃ (Control) is the one this
// island has not touched yet — `placeKeys.ts` is the only map here that reads
// the raw Control key, and for an unrelated chord (⌃⇥).
//
// **Every claimant checked:**
//
// - **Tauri's default macOS menu**, muda 0.19.3 `items/predefined.rs:301-339`
//   (verified against the vendored crate source, not the changelog): ⌘C/X/V,
//   ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌃⌘F (Enter Full Screen — the menu's only Control
//   chord, and it is F, not D), ⌘H, ⌥⌘H, ⌘W, Alt+F4, ⌘Q. No ⌘D of any kind.
// - **Upstream's window handler** (`app/useAppShellKeyboardShortcuts.ts`):
//   ⌘F, ⌘K, ⇧⌘K, ⇧⌘N, ⇧⌘O, ⇧⌘A — reads `event.altKey` but never
//   `event.ctrlKey`, so a chord it doesn't recognize (⌃⌘D's "d" matches none
//   of its branches) falls through untouched rather than being silently
//   eaten.
// - **The app's other global maps**: ⌘, (`useSettingsShortcuts.ts`),
//   ⌘±/⌘0 (`useWebviewZoomShortcuts.ts`), ⌘R (`useReloadShortcut.ts`),
//   ⌘[/⌘]/⌃⌘←→ (`useBackForwardControls.ts` — its only Control chord is the
//   arrow pair, not a letter), Escape (`useMarkAsReadShortcuts.ts`). None is
//   ⌃⌘D.
// - **This island's own maps**: ⌘1…9/⌘\`/⌘T/⇧⌘W/⌥⌘←→/⌥⌘T
//   (`terminalKeys.ts`), ⌘K (`paletteKeys.ts`), ⌘B/⇧⌘B (`columnKeys.ts`),
//   ⌥⌘B/⇧⌥⌘B (`paneKeys.ts`), ⇧⌘M (`scratchMarkdownKeys.ts`), ⇧⌘F
//   (`searchKeys.ts`). None reads Control, so none can already answer to
//   ⌃⌘D.
// - **The composer's own ProseMirror keymap**: `prosemirror-commands`'
//   `baseKeymap` (pulled in by Tiptap's StarterKit, which
//   `useRichTextEditor.ts` builds the editor from) binds plain `Ctrl-d` to
//   `deleteContentForward` — a genuine claimant, named here rather than
//   left off the list, even though it cannot collide: ProseMirror's `Ctrl-d`
//   is Control **alone** with `d`, and `event.ctrlKey && event.metaKey`
//   (⌃⌘D) is a different, more-specific chord than plain `event.ctrlKey`
//   that a keymap binding only the latter can never match.
// - **AppKit's ⌥-synthesis rule** (`scratchMarkdownKeys.ts`'s header): macOS
//   synthesizes an ⌥-variant for Window-menu items (⌘M → ⌥⌘M for Minimize),
//   which is why that map avoids ⌥+letter where ⌘+letter is a Window-menu
//   item. There is no analogous Control-synthesis: the muda menu's only
//   Control chord (⌃⌘F, Fullscreen) is a fixed accelerator on one item, not a
//   pattern AppKit generates for every Window-menu entry the way it does for
//   ⌥. macOS's own system-wide Dictation shortcut is "press Control twice",
//   not a modified letter, so it does not collide either.
//
// Pure: no React, no Tauri, no storage — the same `resolve*` shape as every
// other key map in this island.

import type { KeyInput } from "@/features/runs/lib/terminalKeys";

export type DictationKeyAction = { type: "toggle-dictation" };

/** Resolves ⌃⌘D, or `null` for anything else. Auto-repeat is not a second
 * press — dictation is a toggle, and a held-down chord delivers repeat
 * keydowns the same way every other discrete chord in this island guards
 * against. */
export function resolveDictationKey(
  input: KeyInput,
): DictationKeyAction | null {
  if (input.repeat === true) return null;
  if (!input.primaryModifier) return null;
  if (input.ctrlKey !== true) return null;
  if (input.shiftKey === true) return null;
  if (input.altKey === true) return null;
  if (input.key.toLowerCase() !== "d") return null;
  return { type: "toggle-dictation" };
}
