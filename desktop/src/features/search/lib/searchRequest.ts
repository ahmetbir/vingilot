// **A click that means "open the search dialog"** (vingilot P1.1, veto 1).
//
// The sidebar's search box was the dialog's one visible trigger; the veto
// removed the box, not the dialog. The ⌘K palette now carries a "Search
// messages" row, and this module is the one-slot mailbox that carries that
// click to wherever the dialog is mounted (`TopbarSearch`'s hidden variant) —
// the `paletteRequest.ts` idiom, byte for byte: the palette posts a request,
// the mounted dialog consumes it. No React, no DOM, no persistence — a
// request outliving the click that made it would open a dialog the owner
// stopped asking for.

type Listener = () => void;

let pending = false;
const listeners = new Set<Listener>();

/** Ask the mounted search dialog to open. Fire-and-forget: with no dialog
 * mounted (a screen mid-transition) the request waits for the next subscriber
 * check, and a second request is the same request. */
export function requestSearchOpen(): void {
  pending = true;
  for (const listener of listeners) listener();
}

/** Take the pending request, clearing it — a request is consumed once. */
export function takeSearchRequest(): boolean {
  const request = pending;
  pending = false;
  return request;
}

export function subscribeSearchRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
