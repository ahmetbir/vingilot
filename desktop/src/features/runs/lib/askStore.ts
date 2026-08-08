// Where the ask conversation lives between app runs, and how a surface hears
// about it (vingilot/docs/plans/2026-08-08-palette-and-documents.md, Task 2).
// Why it is here rather than in a Buzz channel is `askThread.ts`'s header.
//
// **Two writers, one conversation.** The palette asks and the Agent pane reads,
// and the pane is often not mounted when the question is asked — it is the pane
// the ask *switches to*. So the channel between them is this store rather than
// a prop: the host writes, the pane subscribes, and neither has to know the
// other exists. It is also why the in-flight ask is named here instead of held
// in a component's state, which would be lost the moment the pane remounted on
// a worktree switch.
//
// **The pending ask is memory, the exchange is storage.** The question is
// written the moment it is asked, so quitting mid-turn keeps the question the
// owner typed; what is *not* persisted is the fact that a turn is running, so a
// row with no answer after a restart reads as "no answer came back" rather than
// as an ask that is still going (`askThread.ts`'s `exchangeState`).

import {
  appendExchange,
  type AskExchange,
  type AskThreads,
  capThreads,
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

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

export function readThreads(
  storage: StorageLike = defaultStorage(),
): AskThreads {
  return parseThreads(storage.getItem(ASK_KEY));
}

export function writeThreads(
  threads: AskThreads,
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(ASK_KEY, JSON.stringify(capThreads(threads)));
  } catch {
    // A refused write (quota, a private-mode webview) costs the thread its
    // next restart. Throwing here would cost the render that produced it.
  }
}

/** One directory's conversation, oldest first. */
export function readThread(
  cwd: string,
  storage: StorageLike = defaultStorage(),
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

let pending: string | null = null;
let seq = 0;

/** The exchange a turn is in flight for, or `null`. One at a time on purpose:
 * a second question asked while the first is running would be a second adapter
 * process started in the same directory, and the owner asked for neither. */
export function pendingAskId(): string | null {
  return pending;
}

/** Record the question and mark it in flight. Returns the exchange's id, which
 * `settleAsk` needs, or `null` when one is already running. */
export function startAsk(
  cwd: string,
  question: string,
  now: number = Date.now(),
  storage: StorageLike = defaultStorage(),
): string | null {
  if (pending !== null) return null;
  // The clock alone is not an identity: two questions asked in the same
  // millisecond would share a row, and settling one would settle both.
  seq += 1;
  const id = `${now}-${seq}`;
  const exchange: AskExchange = {
    answer: null,
    askedAt: now,
    cwd,
    id,
    question,
    refusal: null,
  };
  writeThreads(appendExchange(readThreads(storage), exchange), storage);
  pending = id;
  notify();
  return id;
}

export function settleAsk(
  cwd: string,
  id: string,
  outcome: { answer: string } | { refusal: string },
  storage: StorageLike = defaultStorage(),
): void {
  writeThreads(settleExchange(readThreads(storage), cwd, id, outcome), storage);
  if (pending === id) pending = null;
  notify();
}

/** For tests, which share one module instance across cases. */
export function resetAskPending(): void {
  pending = null;
}
