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
//
// **And `Enter` on a focused control belongs to that control.** The listener
// is on `window`, so while the Diff tab is mounted it sees every keydown in
// the app — including `Enter` on a focused WorkSurface tab button or file row,
// which the platform means as "press this". `focusActivates` is how the caller
// says the focused element is one of those, and `Enter` is then left alone.
// `j`/`k` are not: no button does anything with a letter, and the file rows
// themselves are buttons, so surrendering letters to them would stop the
// cursor keys working the moment the owner clicked a row.

export type DiffKeyAction =
  | { type: "step-file"; dir: -1 | 1 }
  | { type: "open-file" };

/** As much of the focused element as this map needs, so the decision is
 * testable without a DOM. `null` when nothing in the document has focus. */
export interface FocusedElement {
  /** Uppercase, as `Element.tagName` reports it. */
  tagName: string;
  contentEditable: boolean;
  /** An explicit `role` attribute, which is how a `div` becomes a button. */
  role: string | null;
}

/** Elements that treat `Enter` as "activate me". A key this list claims is the
 * platform's, not this panel's. */
const ACTIVATES_ON_ENTER = new Set([
  "BUTTON",
  "A",
  "SELECT",
  "SUMMARY",
  "OPTION",
]);
const ACTIVATING_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "option",
  "tab",
]);

/** True when the caret is somewhere a letter is a letter. */
export function isTypingTarget(focus: FocusedElement | null): boolean {
  if (focus === null) return false;
  return (
    focus.tagName === "INPUT" ||
    focus.tagName === "TEXTAREA" ||
    focus.contentEditable
  );
}

/** True when the focused element is one `Enter` already presses. */
export function activatesOnEnter(focus: FocusedElement | null): boolean {
  if (focus === null) return false;
  if (focus.role !== null) return ACTIVATING_ROLES.has(focus.role);
  return ACTIVATES_ON_ENTER.has(focus.tagName);
}

export interface DiffKeyInput {
  key: string;
  /** True when the caret is in a text field — a `j` there is a letter. */
  inField: boolean;
  /** True when the focused element is one `Enter` activates. Only `Enter` is
   * given up: see the note above. */
  focusActivates?: boolean;
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

  if (input.key === "Enter") {
    return input.focusActivates === true ? null : { type: "open-file" };
  }
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
