// **A click that means what ⌘K means** (vingilot redesign P1, top bar).
//
// The new top bar carries a "Search everything ⌘K" pill and a History button,
// and both open the palette — the same palette the chord opens, on whichever
// host currently owns it (`paletteClaim.ts` keeps exactly one `usePalette`
// mounted at a time). A click is not a keydown, so the claim-by-capture that
// settles the chord cannot carry it; this module is the one-slot mailbox that
// does, in the `workspaceLanding.ts` / `filesTarget.ts` idiom: the bar posts a
// request, the mounted host consumes it. No React, no DOM, no persistence —
// a request outliving the click that made it would open a palette the owner
// stopped asking for.

import type { PaletteDoor } from "./paletteDoors.ts";

type Listener = () => void;

let pending: PaletteDoor | null = null;
const listeners = new Set<Listener>();

/** Ask the mounted palette host to open on `door`. Fire-and-forget: with no
 * host mounted (a screen mid-transition) the request waits for the next
 * subscriber check, and a second request simply overwrites the first. */
export function requestPaletteOpen(door: PaletteDoor) {
  pending = door;
  for (const listener of listeners) listener();
}

/** Take the pending request, clearing it — a request is consumed once. */
export function takePaletteRequest(): PaletteDoor | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribePaletteRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
