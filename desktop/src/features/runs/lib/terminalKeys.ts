// Pure keyboard-resolution for the Projects/Terminal work surface (see
// vingilot/docs/plans/2026-08-06-projects-and-terminal.md's layout contract):
// ⌘1…9 switches worktrees (iTerm tab muscle memory), ⌘` focuses the
// terminal, Esc leaves it. A pure `resolveKey`-style function so the key map
// is unit-testable without mounting React or a real keyboard event — the
// caller (RunsScreen/WorkSurface) wires it to a `keydown` listener and the
// platform's primary shortcut modifier (⌘ on macOS, Ctrl elsewhere; see
// `shared/lib/platform.ts`'s `hasPrimaryShortcutModifier`).

export type TerminalKeyAction =
  | { type: "switch-worktree"; index: number }
  | { type: "focus-terminal" }
  | { type: "leave-terminal" };

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
  if (input.altKey) return null;

  if (input.primaryModifier && !input.shiftKey) {
    const index = digitIndex(input.key);
    if (index !== null) {
      return { type: "switch-worktree", index };
    }
    if (input.key === "`") {
      return { type: "focus-terminal" };
    }
    return null;
  }

  if (!input.primaryModifier && !input.shiftKey && input.key === "Escape") {
    return { type: "leave-terminal" };
  }

  return null;
}
