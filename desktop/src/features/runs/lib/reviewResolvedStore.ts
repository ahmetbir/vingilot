// Which review notes the owner has marked resolved.
//
// **Local, and it has to be.** A note is a relay message the reviewer signed;
// this app cannot edit it, and writing a "resolved" event back into the channel
// would be the owner's key asserting something about somebody else's message.
// What "Resolve" means here is what it honestly can mean — *I have dealt with
// this one, stop putting it in front of me* — so it is a set of event ids on
// this machine, and the footer's unresolved count is counted against it.
//
// The store shape is `diffMode.ts`'s, for the third time and for the same
// reasons stated there: module singleton, listener set, `localStorage` as a
// best-effort mirror, versioned key. Not community-scoped — an event id is
// globally unique, so a set of them carries nothing that could leak from one
// community into another and it is deliberately absent from
// `resetCommunityState()`.

const STORAGE_KEY = "vingilot-review-resolved.v1";

/** How many ids are kept. A note's id is 64 hex characters; ten thousand of
 * them is well under a megabyte, and past that the oldest are dropped rather
 * than letting one preference grow without a ceiling. */
const MAX_IDS = 10_000;

const listeners = new Set<() => void>();

function parse(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function readStored(): ReadonlySet<string> {
  try {
    return new Set(parse(globalThis.localStorage?.getItem(STORAGE_KEY)));
  } catch {
    return new Set();
  }
}

let resolved: ReadonlySet<string> = readStored();

export function getResolvedNotes(): ReadonlySet<string> {
  return resolved;
}

export function subscribeResolvedNotes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: ReadonlySet<string> = new Set();

/** The empty set, for a snapshot taken where there is no storage to read. A
 * module constant rather than a fresh `Set()`: `useSyncExternalStore` compares
 * snapshots by identity and a new object each call is an infinite render. */
export function serverResolvedNotes(): ReadonlySet<string> {
  return EMPTY;
}

/** Mark one note resolved, or put it back. */
export function setNoteResolved(id: string, value: boolean): void {
  if (resolved.has(id) === value) return;
  const next = new Set(resolved);
  if (value) next.add(id);
  else next.delete(id);
  const kept = next.size > MAX_IDS ? [...next].slice(-MAX_IDS) : [...next];
  resolved = new Set(kept);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Best effort: the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

/** Test-only. */
export function resetResolvedNotesForTests(): void {
  resolved = new Set();
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to undo.
  }
  for (const listener of listeners) listener();
}
