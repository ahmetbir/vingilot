// Pure keyboard-resolution for the Projects/Terminal work surface (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's layout contract):
// ⌘1…9 switches worktrees (iTerm tab muscle memory), ⌘` focuses the
// terminal, Esc leaves it, and ⌘T/⇧⌘W/⌥⌘←→ work the worktree's own terminal
// tabs. A pure `resolveKey`-style function so the key map is unit-testable
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
  | { type: "move-terminal-tab"; dir: -1 | 1 };

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
  // itself. These are the only chords here that use ⌥ — everything below is
  // resolved only with it released, which is why the short-circuit that used
  // to open this function now follows them instead of preceding them.
  if (input.altKey) {
    if (!input.primaryModifier) return null;
    const dir = arrowDirection(input.key);
    if (dir === null) return null;
    return input.shiftKey
      ? { dir, type: "move-terminal-tab" }
      : { dir, type: "step-terminal-tab" };
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
