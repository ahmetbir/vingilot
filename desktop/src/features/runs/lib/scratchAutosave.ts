// When the scratch buffer is written to disk, and what the owner is told about it
// (vingilot/docs/plans/2026-08-12-vscode-muscle-memory.md, Task 4).
//
// **Why this is not `autosave.ts`, said before anything else, because "a second
// autosave" is exactly the kind of thing that should have to justify itself.**
// That module's contract is `write: (text) => boolean` — *"Returns whether the
// write landed. A `false` here is what `failed` is."* — and its whole value is
// the promise built on it: **never say saved before storage has taken it.** The
// notes and plan panes can keep that promise synchronously because their storage
// is `localStorage`, which answers in the same tick.
//
// This buffer's storage is a file behind the Tauri IPC (`scratchClient.ts` →
// `vingilot_scratch`), and a boolean cannot express "asked, not yet answered".
// There were three ways out and two of them break something:
//
// 1. `write: (text) => { void send(text); return true; }` — reports `saved` for a
//    write that has not happened and may fail. That is the one promise neither
//    module is allowed to break.
// 2. Make `autosave.ts`'s `write` return `boolean | Promise<boolean>`. One
//    module, but the notes and plan panes' `stop()` — which runs inside an
//    unmount and inside `pagehide` — would grow an asynchronous tail it does not
//    have today, on the path whose entire purpose is that it completes before
//    the page goes.
// 3. This: the same vocabulary, the same two numbers, a second machine for the
//    asynchronous case. `SaveState`, `DEBOUNCE_MS` and `CEILING_MS` are
//    **imported** from `autosave.ts` rather than copied, so there is one
//    definition of what the owner is told and one pair of numbers; what differs
//    is only the part that is genuinely different, which is what happens between
//    asking and being answered.
//
// **What is genuinely different, in three rules.**
//
// - **One write at a time.** Keystrokes during a write do not start a second
//   one; they leave the newest text outstanding and it goes as soon as the first
//   is answered. That bounds the write rate by the IPC's latency rather than by
//   how fast he types, and it means two writes can never race for the same file
//   — which matters, because `vingilot_scratch` publishes through one temp path
//   and a rename, and two renames in flight over one temp file is the one way
//   that scheme loses.
// - **`saved` comes from the answer, never from the asking.** The state goes to
//   `saved` when a write returns `true` *and* nothing newer is outstanding.
// - **A refusal keeps the text.** Exactly `autosave.ts`'s rule: the text stays
//   pending so the next keystroke tries again, and `failed` stays said until a
//   write succeeds. A disk that filled up and was cleared recovers without the
//   owner having to know anything happened.
//
// Time, timers and the write are all injected, so a test drives them rather than
// sleeping and "what was written, in which order" has an exact answer.

import {
  type AutosaveClock,
  CEILING_MS,
  DEBOUNCE_MS,
  type SaveState,
} from "./autosave.ts";

export interface ScratchAutosaveOptions {
  /** The text the file already holds. Nothing is written until the buffer
   * differs from it — including when an edit is undone back to it. */
  saved: string;
  /** Resolves to whether the write landed. A rejection is a refusal too: the
   * IPC failing is not a different outcome from the filesystem refusing, as far
   * as what the owner is told goes. */
  write: (text: string) => Promise<boolean>;
  /** Called only when the state actually changes. */
  onState: (state: SaveState) => void;
  clock: AutosaveClock;
  debounceMs?: number;
  ceilingMs?: number;
}

export interface ScratchAutosave {
  /** The buffer changed. */
  edit: (text: string) => void;
  /** Write anything outstanding now, and cancel the timer.
   *
   * **Not "the editor is over".** The scratch buffer outlives its overlay — it is
   * one global buffer and the machine is a module singleton beside it
   * (`useScratchMarkdown.ts`), so closing the overlay stops nothing and the
   * debounce simply lands a moment later. What calls this is the *page* ending
   * (`pagehide`/`beforeunload`), which is the one moment the timer will not get
   * to fire. Idempotent, and safe on a buffer nothing was typed into. */
  stop: () => void;
}

export function createScratchAutosave(
  options: ScratchAutosaveOptions,
): ScratchAutosave {
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const ceilingMs = options.ceilingMs ?? CEILING_MS;
  const { clock, onState, write } = options;

  /** The last text known to be in the file. */
  let written = options.saved;
  /** Text that differs from `written` and has not been *answered for*. `null`
   * means there is nothing outstanding. Deliberately not cleared when a write is
   * sent: until the answer arrives nothing is known to be stored, and clearing
   * it early would let `stop()` conclude there was nothing to write. */
  let pending: string | null = null;
  /** When the current run of unwritten edits began, for the ceiling. */
  let dirtySince = 0;
  let timer: number | null = null;
  let state: SaveState = "saved";
  /** The text a write is currently out for, or `null` when none is. This is the
   * one-write-at-a-time rule, held as a value rather than a flag so `settle` can
   * tell "the answer is about the newest text" from "he typed while it was in
   * flight". */
  let inFlight: string | null = null;

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

  function settle(sent: string, landed: boolean): void {
    inFlight = null;
    if (!landed) {
      announce("failed");
      return;
    }
    written = sent;
    if (pending === sent) {
      pending = null;
      announce("saved");
      return;
    }
    // He typed while the write was out, so the newest text is still outstanding.
    // Sent immediately rather than after another debounce: the wait was already
    // paid once, and the rate is bounded by the write's own latency because only
    // one can be out at a time.
    send();
  }

  function send(): void {
    // The one-write-at-a-time rule. `settle` picks the newer text up.
    if (inFlight !== null) return;
    if (pending === null) return;
    const text = pending;
    inFlight = text;
    void write(text).then(
      (landed) => settle(text, landed),
      // A rejected promise is a refusal. Reported as `failed` like any other,
      // because "the bridge to the backend broke" and "the disk refused" are the
      // same fact to somebody looking at a buffer that is not saved.
      () => settle(text, false),
    );
  }

  function flush(): void {
    cancel();
    send();
  }

  function edit(text: string): void {
    // Typed back to what the file holds — including the very common case of an
    // edit undone. Nothing to write, and a pending write of the old text would
    // be a write of text that is no longer on screen.
    //
    // Only while nothing is in flight: with a write out for older text, this
    // text really is still outstanding (the file does not hold it yet), and
    // claiming `saved` here would claim it about a write that has not landed.
    if (text === written && inFlight === null) {
      cancel();
      pending = null;
      announce("saved");
      return;
    }
    if (pending === null) dirtySince = clock.now();
    pending = text;
    // A failed write is not downgraded to `unsaved` by a later keystroke: the
    // last thing this machine knows is that the file refused it, and it stays
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
