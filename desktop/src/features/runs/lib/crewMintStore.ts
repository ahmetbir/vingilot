// Where "no thanks" is kept, and nowhere else
// (vingilot/docs/plans/2026-08-12-the-crew.md, Task 2 — *"Decline is
// remembered; nothing nags."*).
//
// One boolean, in `localStorage`, injectable so a plain `node --test` with no
// DOM can drive it with an in-memory shim — the arrangement `paletteStore.ts`
// and `paneStore.ts` already use, and tolerant for the same reason: a read that
// fails must not throw during the render that puts the workspace on screen.
//
// **It fails towards asking, not towards silence.** Unreadable storage reads as
// "not declined", so the worst a broken read costs is one dialog the Captain
// dismisses again — whereas failing the other way would hide an offer he never
// answered and leave a workspace with no crew and no way to be asked for one.
// There is no `undecline`: the offer is a first-run courtesy, and the way to
// get a crew after saying no is the ⌘K row that mints one, which is the door
// that was always there.
//
// Versioned key, for `paletteStore.ts`'s reason: a future shape change gets a
// new key rather than a migration, so an older build reading a newer value
// finds nothing and asks rather than half-understanding it.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DECLINED_KEY = "vingilot-crew-offer.v1";

/** What a decline is written as. Any other value — including a missing key —
 * reads as "not declined". */
const DECLINED = "declined";

const NO_STORAGE: StorageLike = {
  getItem: () => null,
  setItem: () => {},
};

function defaultStorage(): StorageLike {
  return (
    (globalThis as { localStorage?: StorageLike }).localStorage ?? NO_STORAGE
  );
}

/** Has the Captain already said no? Never throws: a storage that refuses to be
 * read is the same answer as a storage with nothing in it. */
export function crewOfferDeclined(
  storage: StorageLike = defaultStorage(),
): boolean {
  try {
    return storage.getItem(DECLINED_KEY) === DECLINED;
  } catch {
    return false;
  }
}

/** Remember the decline. A write that fails is swallowed for the reason the
 * read is: the cost is being asked once more, and there is no surface on which
 * "your refusal could not be saved" would be a useful thing to say. */
export function declineCrewOffer(
  storage: StorageLike = defaultStorage(),
): void {
  try {
    storage.setItem(DECLINED_KEY, DECLINED);
  } catch {
    // See above.
  }
}
