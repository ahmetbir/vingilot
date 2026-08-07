// Pure keyboard resolution for the Diff panel's file list
// (vingilot/docs/plans/2026-08-07-workspace-v1.md, Task 7): `j`/`k` between
// files, `Enter` to open the one under the cursor. Same idiom as
// `terminalKeys.ts` — a function from a key description to an action, so the
// map is unit-testable without React or a real keyboard event, and the caller
// decides whether now is the time to act on it.
//
// **A cursor is not a selection.** `j`/`k` move a highlight through the list
// and open nothing; `Enter` is what puts a file in the viewer. That is what
// makes the keys usable on a 300-file diff, where opening every file you pass
// over would mean 300 patches rendered to reach the one you wanted.
//
// **A key typed into a field is a character.** The base ref is a text input
// sitting in the same panel, so `j` reaches this map with the caret inside it
// — `inField` is how the caller says so, and the answer is `null`. Arrow keys
// are deliberately not bound: they belong to whatever has focus.

export type DiffKeyAction =
  | { type: "step-file"; dir: -1 | 1 }
  | { type: "open-file" };

export interface DiffKeyInput {
  key: string;
  /** True when the caret is in a text field — a `j` there is a letter. */
  inField: boolean;
  /** Any modifier held. Every chord here is unmodified: `⌘K`, `⌥j` and the
   * rest belong to the app and the platform, not to this list. */
  primaryModifier?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

/** Resolves one keydown into a file-list action, or `null` when this map has
 * nothing to say — in which case the caller must let the event through
 * untouched rather than swallowing it. Never throws.
 *
 * Auto-repeat *is* honoured here, unlike `terminalKeys.ts`: holding `j` to run
 * down a long list is the whole point of `j`, and moving a cursor costs
 * nothing, where the chords there each spawn a shell. */
export function resolveDiffKey(input: DiffKeyInput): DiffKeyAction | null {
  if (input.inField) return null;
  if (input.primaryModifier === true) return null;
  if (input.altKey === true) return null;

  if (input.key === "Enter") return { type: "open-file" };
  // Case-sensitive, and only these two letters: `J`/`K` are free for
  // something else later, and a shifted letter is not a mistyped one.
  if (input.shiftKey === true) return null;
  if (input.key === "j") return { dir: 1, type: "step-file" };
  if (input.key === "k") return { dir: -1, type: "step-file" };
  return null;
}

/** Where the cursor lands after a step. Clamped at both ends rather than
 * wrapping: a file list is a list, not a ring, and `j` held down at the bottom
 * should stop there instead of silently starting again at the top — the owner
 * would not notice the wrap and would read the wrong file. `-1` for an empty
 * list, which is "no file under the cursor". */
export function nextFileIndex(
  current: number,
  count: number,
  dir: -1 | 1,
): number {
  if (count <= 0) return -1;
  const from = current < 0 ? (dir === 1 ? -1 : count) : current;
  return Math.min(Math.max(from + dir, 0), count - 1);
}
