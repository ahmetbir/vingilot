// Where the ask conversation lives between app runs, and how a surface hears
// about it (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
// Why it is here rather than in a Buzz channel is `askThread.ts`'s header.
//
// **Two writers, one conversation.** The palette and the Agent pane's own box
// both ask, and the pane is often not mounted when a palette question is asked
// — it is the pane the ask *switches to*. So the channel between them is this
// store rather than a prop: whoever asks writes, the pane subscribes, and
// neither has to know the other exists. It is also why the in-flight turn is
// named here instead of held in a component's state — which is exactly how the
// pane's Run button came to start a second adapter behind the palette's back,
// and which would be lost the moment the pane remounted on a worktree switch.
//
// **The pending ask is memory, the exchange is storage.** The question is
// written the moment it is asked, so quitting mid-turn keeps the question the
// owner typed; what is *not* persisted is the fact that a turn is running, so a
// row with no answer after a restart reads as "no answer came back" rather than
// as an ask that is still going (`askThread.ts`'s `exchangeState`).
//
// **And when storage will not take it, the conversation is still the
// conversation.** A refused write kept nothing and said nothing, which lost the
// question outright — see `unstored` below. It is held in memory instead, and
// `asksUnstored` is what the pane says it with.

import {
  appendExchange,
  type AskExchange,
  type AskThreads,
  capThreads,
  NOT_ASKED_NOTE,
  parseThreads,
  settleExchange,
} from "./askThread.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Versioned for the reason `paletteStore.ts` gives: a shape change gets a new
 * key rather than a migration. */
const ASK_KEY = "vingilot-ask.v1";

/** `null`, not a no-op shim, for the reason `documentStore.ts` gives: a store
 * that takes writes and keeps nothing lets this app claim a question landed. */
function defaultStorage(): StorageLike | null {
  return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
}

/** The conversation as it stands when storage would not take it.
 *
 * **A refused write used to be swallowed here**, and what that cost was not the
 * thread's next restart — it was the question. Everything that draws this
 * conversation reads it back out of storage (the pane is usually not even
 * mounted when the palette asks), so a write storage refused left the owner
 * with a question typed, a turn running against it, and nothing on screen. Not
 * an empty answer: no row at all, and no word about why.
 *
 * So a refusal keeps the whole conversation here instead. It is the same
 * promise the document panes make — never claim it landed, never lose it
 * quietly — with the one difference the medium forces: this is memory, so it
 * goes when the app does, and `asksUnstored` is how the surface says so.
 *
 * A later write that succeeds clears it, and because reads come from here
 * while it stands, that write carries the rows storage refused earlier. A
 * quota that frees up therefore recovers the conversation whole. */
let unstored: AskThreads | null = null;

export function readThreads(
  storage: StorageLike | null = defaultStorage(),
): AskThreads {
  if (unstored !== null) return unstored;
  if (storage === null) return {};
  try {
    return parseThreads(storage.getItem(ASK_KEY));
  } catch {
    // A webview that refuses reads has told us nothing about what is stored,
    // which is the same position as an unparseable one.
    return {};
  }
}

/** Write the whole conversation. **Returns whether storage took it** — a
 * `false` means what is on screen is all there is, and the caller must not say
 * otherwise. */
export function writeThreads(
  threads: AskThreads,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const capped = capThreads(threads);
  try {
    if (storage === null) throw new Error("no storage on this build");
    storage.setItem(ASK_KEY, JSON.stringify(capped));
  } catch {
    unstored = capped;
    return false;
  }
  unstored = null;
  return true;
}

/** Whether the conversation on screen is only in memory. `true` means storage
 * refused it and it goes when this app does. */
export function asksUnstored(): boolean {
  return unstored !== null;
}

/** One directory's conversation, oldest first. */
export function readThread(
  cwd: string,
  storage: StorageLike | null = defaultStorage(),
): AskExchange[] {
  return readThreads(storage)[cwd] ?? [];
}

const listeners = new Set<() => void>();

/** Told whenever a question is asked or answered. Returns the unsubscribe. */
export function subscribeToAsks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** The one turn this app has running, whichever surface started it. */
export interface AskInFlight {
  /** The exchange the turn is running for. */
  id: string;
  /** The directory it was started in. Kept because a refusal has to name it:
   * the guard is one adapter for the whole app, not one per directory, so the
   * turn that blocks a question is often not in the worktree on screen. */
  cwd: string;
}

let inFlight: AskInFlight | null = null;
let seq = 0;

/** The turn in flight, or `null`. One at a time on purpose: a second turn
 * started while the first runs is a second adapter process — a second login
 * and a second billed turn on a hosted adapter — and the owner asked for
 * neither. Both doors into a turn claim this same mark, so it cannot say one
 * thing while a surface believes another. */
export function pendingAsk(): AskInFlight | null {
  return inFlight;
}

/** Record the question and mark it in flight. Returns the exchange's id, which
 * `settleAsk` needs, or `null` when a turn was already running.
 *
 * **A `null` still wrote the question**, as an exchange refused on the spot.
 * Surfaces refuse before they get here (`askMode.ts` for the palette, the Run
 * button's own disabled state for the pane), so this is the losing side of a
 * race — and a question that loses a race must still be somewhere the owner
 * can find it, because from where he is sitting it looked exactly like the one
 * that won. */
export function startAsk(
  cwd: string,
  question: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): string | null {
  // The clock alone is not an identity: two questions asked in the same
  // millisecond would share a row, and settling one would settle both.
  seq += 1;
  const id = `${now}-${seq}`;
  const busy = inFlight !== null;
  const exchange: AskExchange = {
    answer: null,
    askedAt: now,
    cwd,
    id,
    question,
    refusal: busy ? NOT_ASKED_NOTE : null,
  };
  writeThreads(appendExchange(readThreads(storage), exchange), storage);
  if (!busy) inFlight = { cwd, id };
  notify();
  return busy ? null : id;
}

export function settleAsk(
  cwd: string,
  id: string,
  outcome: { answer: string } | { refusal: string },
  storage: StorageLike | null = defaultStorage(),
): void {
  writeThreads(settleExchange(readThreads(storage), cwd, id, outcome), storage);
  if (inFlight?.id === id) inFlight = null;
  notify();
}

/** For tests, which share one module instance across cases: the turn mark and
 * the memory a refused write left behind, which is the rest of this module's
 * state. */
export function resetAskPending(): void {
  inFlight = null;
  unstored = null;
}
