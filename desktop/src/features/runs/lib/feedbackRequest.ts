// "Open the feedback dialog", from anywhere — `searchRequest.ts`'s mailbox,
// for the same reason: the palette row and the top-chrome button both live
// outside the dialog's own tree, and the dialog is mounted once, at the root.

type Listener = () => void;

let pending = false;
const listeners = new Set<Listener>();

/** Ask the mounted dialog to open. Fire-and-forget: with no dialog mounted the
 * request waits for the next subscriber check, and a second request is the
 * same request. */
export function requestFeedbackOpen(): void {
  pending = true;
  for (const listener of listeners) listener();
}

/** Take the pending request, clearing it — a request is consumed once. */
export function takeFeedbackRequest(): boolean {
  const request = pending;
  pending = false;
  return request;
}

export function subscribeFeedbackRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
