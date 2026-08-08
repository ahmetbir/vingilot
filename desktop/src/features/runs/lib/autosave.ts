// When a document is written, and what the owner is told about it
// (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 3).
//
// **The whole reason this is a module and not four lines in the pane** is
// `stop`. A debounce is a timer holding the newest text; whatever ends the
// editor's life — the pane switching, ⌥⌘B hiding the right side, the project
// changing — cancels that timer, and the plain implementation cancels it
// *without writing*. The owner watches himself type a sentence and it is gone,
// and no lint, type or availability rule can see it happen. `usePanes` hit the
// same thing with the divider's ratio and fixed it there in a ref; a note is
// the owner's own writing, so here it is a rule of the machine with a test
// that unmounts mid-debounce.
//
// **A ceiling, as well as a debounce.** A trailing debounce that restarts on
// every keystroke never fires while someone is typing steadily, so a long
// uninterrupted paragraph is a long unwritten one. The write happens
// `DEBOUNCE_MS` after the last keystroke *or* `CEILING_MS` after the first
// unwritten one, whichever comes first.
//
// Time and timers are injected: a test drives them rather than sleeping, and
// "did the unmount write?" is then a question with an exact answer instead of
// a race.

/** What the surface says about the document on screen.
 *
 * - `saved`: storage holds exactly this text.
 * - `unsaved`: it does not yet, and a write is coming.
 * - `failed`: a write was attempted and refused. Deliberately not folded into
 *   `unsaved` — one is a promise, the other is the absence of one, and telling
 *   the owner "unsaved" about a document that cannot be saved at all would
 *   have him wait for a write that is never coming. */
export type SaveState = "failed" | "saved" | "unsaved";

/** After the last keystroke. Long enough that an ordinary burst of typing is
 * one write rather than thirty, short enough that the state on screen is never
 * stale for as long as it takes to notice it. */
export const DEBOUNCE_MS = 600;

/** After the first unwritten keystroke, whatever the typing is doing. Four
 * seconds of prose is the most this machine will ever hold and not have
 * written. */
export const CEILING_MS = 4000;

export interface AutosaveClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
}

export interface AutosaveOptions {
  /** The text storage already holds. The machine writes nothing until the
   * document differs from it — including when an edit is undone back to it. */
  saved: string;
  /** Returns whether the write landed. A `false` here is what `failed` is. */
  write: (text: string) => boolean;
  /** Called only when the state actually changes. */
  onState: (state: SaveState) => void;
  clock: AutosaveClock;
  debounceMs?: number;
  ceilingMs?: number;
}

export interface Autosave {
  /** The document changed. */
  edit: (text: string) => void;
  /** This editor is over: write anything outstanding, now, and cancel the
   * timer. Idempotent, and safe to call on an editor that never changed
   * anything — it writes only what an edit left pending. */
  stop: () => void;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const ceilingMs = options.ceilingMs ?? CEILING_MS;
  const { clock, onState, write } = options;

  /** The last text known to be in storage. */
  let written = options.saved;
  /** Text that differs from `written` and has not been taken by a write.
   * `null` means there is nothing outstanding. */
  let pending: string | null = null;
  /** When the current run of unwritten edits began, for the ceiling. */
  let dirtySince = 0;
  let timer: number | null = null;
  let state: SaveState = "saved";

  function announce(next: SaveState): void {
    if (next === state) return;
    state = next;
    onState(next);
  }

  function cancel(): void {
    if (timer === null) return;
    clock.clearTimer(timer);
    timer = null;
  }

  function flush(): void {
    cancel();
    if (pending === null) return;
    const text = pending;
    if (!write(text)) {
      // The text stays pending on purpose: the next edit re-arms the timer and
      // tries again, so a quota that frees up recovers without the owner
      // having to know anything happened.
      announce("failed");
      return;
    }
    written = text;
    pending = null;
    announce("saved");
  }

  function edit(text: string): void {
    if (text === written) {
      // Typed back to what is stored — including the very common case of an
      // edit undone. Nothing to write, and a pending write of the old text
      // would be a write of text that is no longer on screen.
      cancel();
      pending = null;
      announce("saved");
      return;
    }
    if (pending === null) dirtySince = clock.now();
    pending = text;
    // A failed write is not downgraded to `unsaved` by a later keystroke: the
    // last thing this machine knows is that storage refused it, and it stays
    // said until a write succeeds.
    if (state !== "failed") announce("unsaved");
    cancel();
    const waited = clock.now() - dirtySince;
    timer = clock.setTimer(
      flush,
      Math.max(0, Math.min(debounceMs, ceilingMs - waited)),
    );
  }

  return { edit, stop: flush };
}
