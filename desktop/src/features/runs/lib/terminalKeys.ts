// Pure keyboard-resolution for the Projects/Terminal work surface (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's layout contract):
// ⌘1…9 switches worktrees (iTerm tab muscle memory), ⌘` focuses the
// terminal, Esc leaves it, ⌘T opens a new task on the Deck's strip,
// ⇧⌘W/⌥⌘←→ work the active task's terminal tabs, ⌘D/⇧⌘D split the active
// terminal, ⇧⌘\ puts two TABS side by side on the stage (P4.7's tab split —
// a different act from ⌘D's, see `tabSplit.ts` for all three things this app
// calls a split), and ⌥⌘T opens the scratch shell that keeps none of that
// (`scratchTerminal.ts`). A pure `resolveKey`-style function so the map is
// unit-testable
// without mounting React or a real keyboard event — the caller
// (RunsScreen/WorkSurface) wires it to a `keydown` listener and the platform's
// primary shortcut modifier (⌘ on macOS, Ctrl elsewhere; see
// `shared/lib/platform.ts`'s `hasPrimaryShortcutModifier`).
//
// Resolving a key is not deciding to act on it. Whether the terminal surface
// is even showing is the caller's business — this module says what a chord
// means, not whether now is the time for it.
//
// **⌘D and ⇧⌘D — iTerm's split-right and split-down — are claimed below**
// (2026-08-29 redesign, P2; owner: "terminali ikiye bolmeli suruklemeli").
// They were deliberately unclaimed for one release: the audit passed clean
// but there was no model for a second, sibling terminal to split into. That
// model now exists (`terminalSplit.ts` — one extra pty beside the active
// tab's own, a draggable divider between them), so the chords mean what
// iTerm's fingers expect. The refusal that stood in this header — never
// alias ⌘D to `new-terminal-tab`, because a split keeps sibling context
// visible and a tab replaces the view — still stands, and is now enforced by
// the split being real: `terminal-cmd-d.spec.ts` asserts ⌘D changes no tab.
//
// Audit, re-run for the claim (the five claimants, plus the shell chords P1
// added): the muda default menu binds ⌘D nowhere (its ⇧⌘ list is empty, its
// plain-⌘ list is C/X/V/Z/Y/A/M/H/W/Q + ⌃⌘F and ⌥⌘H); upstream's
// AppShell window handler claims ⇧⌘K/N/O/A and ⌘K only; the app's globals
// are ⌘,/⌘±/⌘0/⌘R/⌘[]/⌃⌘←→/⌘F/Esc; `useShellChords` claims ⌘B and ⌥⌘B;
// this island's own maps end at ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→, ⌥⌘T, ⌘K,
// ⌘B/⇧⌘B, ⌥⌘B/⇧⌥⌘B. One near-claimant sits outside that grep scope and is
// worth naming: `dictationKeys.ts` resolves "d" — but only under ⌃⌘, and
// `hasPrimaryShortcutModifier` is `metaKey && !ctrlKey` on macOS, so ⌃⌘D
// never reaches the split map (probed live by the P2 verify). Nothing else
// resolves "d" with ⌘ held, shifted or not — grep re-run 2026-08-30.

export type TerminalKeyAction =
  | { type: "switch-worktree"; index: number }
  | { type: "focus-terminal" }
  | { type: "leave-terminal" }
  | { type: "new-task" }
  | { type: "close-terminal-tab" }
  | { type: "step-terminal-tab"; dir: -1 | 1 }
  | { type: "move-terminal-tab"; dir: -1 | 1 }
  | { type: "open-scratch-terminal" }
  | { type: "split-terminal"; direction: "right" | "down" }
  | { type: "toggle-tab-split" };

/** Which way an arrow points, or `null` for a key that is not one. */
function arrowDirection(key: string): -1 | 1 | null {
  if (key === "ArrowLeft") return -1;
  if (key === "ArrowRight") return 1;
  return null;
}

/** The subset of a KeyboardEvent this module reads — kept minimal so tests
 * can pass plain object literals instead of constructing real events. */
export interface KeyInput {
  key: string;
  /** True when the platform's primary shortcut modifier is held (⌘ on
   * macOS, Ctrl elsewhere) — callers pass `hasPrimaryShortcutModifier(event)`
   * here, not a raw `metaKey`/`ctrlKey` flag, so this module stays
   * platform-agnostic. */
  primaryModifier: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** The raw Control key, which every map here but one deliberately ignores —
   * `primaryModifier` is the platform-agnostic reading and is the one to use.
   * It is here for `placeKeys.ts`, whose chord is *named after* Control (⌃⇥ is
   * VS Code's on every platform, and ⌘⇥ is macOS's own and unreachable), and
   * whose header argues why that one map reads the physical modifier instead. */
  ctrlKey?: boolean;
  /** The raw Command/Super key, here for the same one map and for the other
   * half of its reading. `primaryModifier` cannot express "⌘ is down" off-mac —
   * there it *is* `ctrlKey` — so a map that refuses ⌘ by refusing
   * `primaryModifier` refuses Ctrl on Linux and Windows. `placeKeys.ts` refuses
   * this instead, which is the same chord on every platform. */
  metaKey?: boolean;
  /** True for the auto-repeat keydowns a held-down chord delivers. */
  repeat?: boolean;
}

/** Digit 1-9 → worktree index 0-8 (⌘1 selects the first worktree row).
 * `null` for anything outside 1-9 (⌘0, for instance, is not a worktree
 * switch — Buzz reserves plain ⌘0 elsewhere). */
function digitIndex(key: string): number | null {
  if (key.length !== 1) return null;
  const n = key.charCodeAt(0) - "0".charCodeAt(0);
  if (n < 1 || n > 9) return null;
  return n - 1;
}

/** Resolves one keydown into a terminal action, or `null` when this key map
 * has nothing to say about the event (the caller should let it fall through
 * to whatever else handles it — text input, other shortcuts, etc). Never
 * throws; a KeyInput with unexpected values just resolves to `null`. */
export function resolveKey(input: KeyInput): TerminalKeyAction | null {
  // Auto-repeat is not a second press. Every chord here is a discrete act —
  // ⌘T in particular spawns a shell and, under tmux, a session — and a held
  // key delivers 15-30 keydowns a second, so without this a leaned-on ⌘T
  // leaves the owner with dozens of live shells removable one click at a
  // time. Nothing in this map is worth holding down; the window-level handler
  // upstream guards the same way (app/AppShell.tsx).
  if (input.repeat === true) return null;

  // ⌥⌘←/→ moves between a worktree's terminal tabs, ⇧ added moves the tab
  // itself, and ⌥⌘T opens the scratch shell. These are the only chords here
  // that use ⌥ — everything below is resolved only with it released, which is
  // why the short-circuit that used to open this function now follows them
  // instead of preceding them.
  if (input.altKey) {
    if (!input.primaryModifier) return null;
    const dir = arrowDirection(input.key);
    if (dir !== null) {
      return input.shiftKey
        ? { dir, type: "move-terminal-tab" }
        : { dir, type: "step-terminal-tab" };
    }
    // ⌥⌘T — the shell that leaves nothing behind, one modifier away from the
    // ⌘T that opens one that keeps everything. ⌥ is already this island's
    // "variant of" modifier (⌥⌘B against ⌘B).
    //
    // **Every claimant checked, because ⌘W was lost this way once.**
    // - **Tauri's default macOS menu**, which this app installs by setting
    //   none (tauri 2.11.5 app.rs:2245). muda 0.19.3
    //   `items/predefined.rs:301-339` is the whole accelerator list: ⌘C/X/V,
    //   ⌘Z, ⇧⌘Z, ⌘Y, ⌘A, ⌘M, ⌃⌘F, ⌘H, ⌥⌘H, ⌘W, Alt+F4, ⌘Q. The only ⌥ chord
    //   in it is ⌥⌘H, so unlike ⌘W this one reaches the webview.
    // - **Upstream's window handler** (app/AppShell.tsx): returns immediately
    //   on `event.altKey`, so it claims no ⌥ chord at all. Its ⇧⌘K/N/O/A and
    //   ⌘K are untouched by this.
    // - **The app's other global maps**: ⌘, (useSettingsShortcuts), ⌘±/⌘0
    //   (useWebviewZoomShortcuts, which also returns on ⌥), ⌘R
    //   (useReloadShortcut), ⌘[ / ⌘] / ⌃⌘←→ (useBackForwardControls), ⌘F
    //   (useChannelFind), plain Escape (useMarkAsReadShortcuts). None is ⌥⌘T.
    // - **This island's own maps**: ⌘1…9, ⌘`, ⌘T, ⇧⌘W, ⌥⌘←→ here; ⌘K
    //   (paletteKeys, which returns on ⌥); ⌘B/⇧⌘B (columnKeys, which returns
    //   on ⌥); ⌥⌘B/⇧⌥⌘B (paneKeys, which resolves only "b"/"∫"/"ı").
    //
    // ⇧ is not ignored: ⇧⌥⌘T is nobody's and claiming it by accident would
    // take a chord this check was never run for.
    if (input.shiftKey === true) return null;
    // "†" is what macOS reports for ⌥t when the ⌥ composition still applies —
    // the same reading `paneKeys.ts` accepts "∫" for. Caps lock reports "T"
    // for the unshifted chord, and losing this to caps lock would be a bug
    // nobody would think to look for.
    const altLetter = input.key.toLowerCase();
    if (altLetter === "t" || altLetter === "†") {
      return { type: "open-scratch-terminal" };
    }
    return null;
  }

  // ⇧⌘W closes a terminal tab, **and ⌘W now does too, from `closeKeys.ts`.**
  //
  // For three releases this header said ⌘W could never reach the webview:
  // Tauri installs its default application menu when the builder sets none,
  // and that menu holds `close_window` at ⌘W, which macOS resolves in
  // `performKeyEquivalent:` before any keydown is delivered. That stopped
  // being true when `src-tauri/src/app_menu.rs` began building this app's menu
  // by hand — `Menu::default()` minus both `close_window` items — and `lib.rs`
  // began installing it. `closeKeys.ts` carries the whole re-run audit, what
  // still closes the window, and the one-rule-two-doors argument.
  //
  // **The two W chords are not the same act, which is why both stay.** ⌘W
  // takes what is on TOP (a dialog, else the palette, else the sheet, else a
  // scratch, else the focused tab — `closeRequest.ts`), and refuses to steal a
  // keystroke from a text field. ⇧⌘W is narrower and unconditional: close this
  // terminal tab, whatever is stacked over it. Folding the second onto the
  // first would take away the only way to close a tab while the palette is
  // open; folding the first onto the second would give the owner a ⌘W that
  // kills a shell out from under a dialog he has not answered.
  if (input.primaryModifier && input.shiftKey === true) {
    // Case-insensitive for the same reason ⌘T is below: ⇧ reports "W", caps
    // lock can report it for the unshifted chord too.
    const shifted = input.key.toLowerCase();
    if (shifted === "w") return { type: "close-terminal-tab" };
    // ⇧⌘D — iTerm's split-horizontally: the new shell goes BELOW the old.
    if (shifted === "d") return { direction: "down", type: "split-terminal" };
    // ⇧⌘\ — the TAB SPLIT (redesign P4.7): two TABS side by side on the
    // stage, which is neither of the other two things this app calls a split
    // (`tabSplit.ts`'s header holds all three names). Both readings are
    // accepted because macOS reports "|" for ⇧\ on a US layout and "\" on
    // layouts where the backslash is not shifted; `chordOf` folds them onto
    // one row.
    //
    // **Why this chord.** VS Code's own split-editor is ⌘\, and ⌘\ is taken
    // here — it is the dock's float toggle, the mockup's own binding
    // (vingilot.js:50, audited in `WorkSurface.tsx`). ⇧ is already this
    // island's "the other half of that act" modifier (⌥⌘B against ⇧⌥⌘B), so
    // the stage's divider sits one modifier from the dock's. Audited against
    // the same six claimants as ⌘W (`closeKeys.ts`): no backslash of any kind
    // appears in muda's predefined accelerator table, upstream's window
    // handler resolves only letters, and this island's other maps end at ⌘/,
    // ⌘`, letters, digits, arrows, Home/End/Enter/Escape/Tab. The one
    // near-claimant is the dock's own ⌘\, which now refuses ⇧ explicitly so
    // the two cannot both answer on a layout that reports "\" for both.
    if (shifted === "\\" || shifted === "|") {
      return { type: "toggle-tab-split" };
    }
    return null;
  }

  if (input.primaryModifier && !input.shiftKey) {
    const index = digitIndex(input.key);
    if (index !== null) {
      return { type: "switch-worktree", index };
    }
    if (input.key === "`") {
      return { type: "focus-terminal" };
    }
    // Matched case-insensitively: macOS reports ⌘⇧T as "T" and ⌘T as "t", but
    // a stuck caps lock reports "T" for the unshifted chord too, and losing
    // ⌘T to caps lock would be a bug nobody would think to look for.
    //
    // ⌘T means a new TASK now (redesign P2, mockup `.taskr`'s own hint): a
    // fresh chip on the tasks strip with a fresh shell in it. A new tab
    // *inside* the current task is the strip's `+`, chord-less — the mockup
    // gives the chord to the larger act and this map follows it.
    const letter = input.key.toLowerCase();
    if (letter === "t") {
      return { type: "new-task" };
    }
    // ⌘D — iTerm's split-vertically: the new shell goes to the RIGHT of the
    // old. The header carries the audit.
    if (letter === "d") {
      return { direction: "right", type: "split-terminal" };
    }
    return null;
  }

  if (!input.primaryModifier && !input.shiftKey && input.key === "Escape") {
    return { type: "leave-terminal" };
  }

  return null;
}
