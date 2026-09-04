// Hold the right ⌥ to talk — the dictation key, and why it is a modifier
// alone (vingilot/docs/plans/2026-08-13-voice.md, Task 3; revised
// 2026-09-04 on the owner's third report through the feedback drop).
//
// **⌃⌘D was the chord for one release, and it broke the D key system-wide.**
// The audit below cleared it against every claimant in the app — the menu,
// upstream's handlers, this island's maps — and missed the one outside the
// app: ⌃⌘D is macOS's own *Look Up in Dictionary*. Consumed inside a
// webview, the system's half of that gesture is left half-done, and from then
// on a plain `d` typed anywhere on the machine reaches nothing until
// something (⇧⌘5, as he found) resets the input state. His report has the
// repro in three lines; nothing in this app's code touches `d` after the
// chord, which is what made the OS the only remaining claimant.
//
// **So the key is a held modifier, as he proposed.** The right ⌥ types no
// character on its own, so there is nothing for the system to swallow;
// down starts listening, up stops it, and a window that loses focus while
// it is held stops too. The left ⌥ stays the text's — it is how accented
// letters are typed — and the mic button and ⌘K's button remain the click
// doors. The old audit is kept below because its method is right; only its
// scope was too small, and the lesson is written at the top for the next
// chord: **the OS's own shortcuts are claimants too.**
//
// ---- the audit that cleared ⌃⌘D inside the app, kept as record ----
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
//   (`terminalKeys.ts`), ⌘K (`paletteKeys.ts`), ⌘B (`columnKeys.ts` — ⇧⌘B
//   retired 2026-08-14, currently unclaimed),
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

export type DictationKeyAction = { type: "hold-start" } | { type: "hold-end" };

/** What a keyboard event says, in the terms this map decides on. `code` is
 * the physical key (`AltRight`), `location` the DOM's 2 for a right-hand
 * modifier — both are read, because WebKit reports one reliably where
 * Chromium reports the other. */
export interface HoldInput {
  code: string;
  key: string;
  location: number;
  repeat: boolean;
  kind: "down" | "up";
}

const RIGHT = 2;

function isRightOption(input: HoldInput): boolean {
  if (input.code === "AltRight") return true;
  return input.key === "Alt" && input.location === RIGHT;
}

/** Hold the RIGHT ⌥ to talk: down starts, up ends, auto-repeat is neither.
 * `null` for every other key — including the left ⌥, which is the one that
 * types accented characters and belongs to the text. */
export function resolveDictationHold(
  input: HoldInput,
): DictationKeyAction | null {
  if (!isRightOption(input)) return null;
  if (input.kind === "up") return { type: "hold-end" };
  if (input.repeat) return null;
  return { type: "hold-start" };
}
