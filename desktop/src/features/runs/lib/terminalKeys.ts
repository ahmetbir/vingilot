// Pure keyboard-resolution for the Projects/Terminal work surface (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's layout contract):
// ⌘1…9 switches worktrees (iTerm tab muscle memory), ⌘` focuses the
// terminal, Esc leaves it, ⌘T/⇧⌘W/⌥⌘←→ work the worktree's own terminal
// tabs, and ⌥⌘T opens the scratch shell that keeps none of that
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

export type TerminalKeyAction =
  | { type: "switch-worktree"; index: number }
  | { type: "focus-terminal" }
  | { type: "leave-terminal" }
  | { type: "new-terminal-tab" }
  | { type: "close-terminal-tab" }
  | { type: "step-terminal-tab"; dir: -1 | 1 }
  | { type: "move-terminal-tab"; dir: -1 | 1 }
  | { type: "open-scratch-terminal" };

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

  // ⇧⌘W closes a terminal tab, and ⌘W deliberately does not.
  //
  // ⌘W never reaches this app on macOS. Tauri installs its default
  // application menu when the builder sets none (tauri 2.11.5 app.rs:2245;
  // desktop/src-tauri/src/lib.rs calls neither `.menu(…)` nor
  // `.enable_macos_default_menu(false)`), and that menu's Window submenu
  // holds `close_window` at ⌘W (menu/menu.rs:163). macOS resolves menu key
  // equivalents in `performKeyEquivalent:` before the webview sees the event,
  // so a handler here never runs and `preventDefault()` never happens: the
  // owner's window closes instead of their tab.
  //
  // Taking ⌘W back would mean replacing the whole default menu, which is also
  // where ⌘Q, ⌘C, ⌘V and ⌘A live for a WKWebView — trading a tab shortcut for
  // copy and paste, in an upstream file, for the whole app. ⇧⌘W is free (the
  // default menu binds no ⇧⌘ chord, and upstream's own window handler claims
  // ⇧⌘K/N/O/A only) and costs nothing but one modifier.
  if (input.primaryModifier && input.shiftKey === true) {
    // Case-insensitive for the same reason ⌘T is below: ⇧ reports "W", caps
    // lock can report it for the unshifted chord too.
    return input.key.toLowerCase() === "w"
      ? { type: "close-terminal-tab" }
      : null;
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
    const letter = input.key.toLowerCase();
    if (letter === "t") {
      return { type: "new-terminal-tab" };
    }
    return null;
  }

  if (!input.primaryModifier && !input.shiftKey && input.key === "Escape") {
    return { type: "leave-terminal" };
  }

  return null;
}
