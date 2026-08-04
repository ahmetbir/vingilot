// Pure model for Deck's pin *set* (ADR-002's central decision meets a human
// here): the set of pinned subjects is Workspace state, written via the
// coordinator's CAS `apply_mutations` protocol and therefore shared across
// devices. See vingilot/docs/plans/2026-08-04-deck-phase-3.md's "Contracts
// fixed here" for the wire shape this mirrors:
//
//   { "deck": { "pins": [ { "id", "kind", "pinnedAt" }, ... ] } }
//
// `readPins` is deliberately tolerant — it is the boundary between "state
// that arrived over the wire from a coordinator we don't fully trust yet"
// and the typed `Pin[]` the rest of Deck operates on. Bad shapes become
// `[]`, never a throw.

export type PinKind = "run";

export interface Pin {
  id: string;
  kind: PinKind;
  pinnedAt: string;
}

function isPin(value: unknown): value is Pin {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.kind === "run" &&
    typeof v.pinnedAt === "string"
  );
}

/** Tolerant read of `deck.pins` from arbitrary workspace state. Anything
 * that isn't a well-formed pin is dropped rather than thrown on. */
export function readPins(state: unknown): Pin[] {
  if (typeof state !== "object" || state === null) return [];
  const deck = (state as Record<string, unknown>).deck;
  if (typeof deck !== "object" || deck === null) return [];
  const pins = (deck as Record<string, unknown>).pins;
  if (!Array.isArray(pins)) return [];
  return pins.filter(isPin);
}

/** Adds `p` to `pins`, idempotent by id: pinning an already-pinned id is a
 * no-op that keeps the original `pinnedAt` (first pin wins the timestamp). */
export function withPin(pins: Pin[], p: Pin): Pin[] {
  if (pins.some((existing) => existing.id === p.id)) return pins;
  return [...pins, p];
}

/** Removes the pin with the given id, if present. */
export function withoutPin(pins: Pin[], id: string): Pin[] {
  return pins.filter((p) => p.id !== id);
}

/** Set difference for the conflict UX: ids present in `theirs` but not
 * `mine` are `added`; ids present in `mine` but not `theirs` are `removed`.
 * Shared ids appear in neither list. */
export function pinsDiff(
  mine: Pin[],
  theirs: Pin[],
): { added: Pin[]; removed: Pin[] } {
  const mineIds = new Set(mine.map((p) => p.id));
  const theirsIds = new Set(theirs.map((p) => p.id));
  return {
    added: theirs.filter((p) => !mineIds.has(p.id)),
    removed: mine.filter((p) => !theirsIds.has(p.id)),
  };
}
