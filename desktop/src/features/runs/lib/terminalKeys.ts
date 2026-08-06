// Pure keyboard-resolution for the Projects/Terminal work surface (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's layout contract):
// ⌘1…9 switches worktrees (iTerm tab muscle memory), ⌘` focuses the
// terminal, Esc leaves it, and ⌘T/⌘W/⌥⌘←→ work the worktree's own terminal
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
    if (letter === "w") {
      return { type: "close-terminal-tab" };
    }
    return null;
  }

  if (!input.primaryModifier && !input.shiftKey && input.key === "Escape") {
    return { type: "leave-terminal" };
  }

  return null;
}
