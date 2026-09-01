// **Is this keystroke aimed at a text field?** — the one reading of that
// question in the workspace island.
//
// It was `useCloseRequest.ts`'s private helper for two releases: ⌘W's bottom
// rung is the only arm of the close stack that can reach past what has focus,
// so a caret in a composer or an objective field had to keep its own ⌘W. P4.5
// gave the strips their own editors — an `<input>` sitting IN the tab bar, in
// the left pane, where the strip's chords (⌘T, ⇧⌘W, ⌥⌘←→, ⇧⌘\) are answered by
// a window listener that had no reason to care about focus before. So there is
// a second caller, and one predicate rather than two that can drift.
//
// **A terminal is not a text field for this purpose**, even though xterm's own
// input is a `<textarea>`: closing the tab from inside its own shell, or
// opening a task from it, is exactly the iTerm hand the owner asked for. That
// exception is the whole reason this cannot be `event.target instanceof
// HTMLInputElement` at each call site.

/** True for a text-entry element that is not a terminal's. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm") !== null) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA"
  );
}
