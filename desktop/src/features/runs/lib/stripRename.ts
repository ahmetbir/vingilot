// **The palette's door onto the two strips' editors** (2026-08-29 redesign,
// P4.5) — a one-slot mailbox in the `paletteRequest.ts` / `filesTarget.ts`
// idiom, and here for the same reason those are: the two ends are far apart.
//
// A rename is not a state change the workspace can perform on the owner's
// behalf — it is a request to put a caret somewhere. The palette runs its
// commands in `RunsScreen`, which owns neither strip's editing state (the
// strips live inside `WorkSurface`, which unmounts on the way to the landing
// view). Threading a "start renaming" prop down for it would put a piece of
// transient focus state in the screen that survives the surface it belongs to.
//
// So the palette posts, and the mounted surface consumes. No React, no DOM, no
// persistence: a request that outlived the keystroke that made it would open an
// editor over work the owner had already moved on from.

/** Which strip the owner asked to rename in — the focused terminal tab, or the
 * task chip holding it. */
export type StripRenameTarget = "terminal" | "task";

let pending: StripRenameTarget | null = null;
const listeners = new Set<() => void>();

/** Ask the mounted work surface to open its editor. Fire-and-forget: with no
 * surface mounted the request waits for the next subscriber check, and a
 * second request overwrites the first — one caret, one place. */
export function requestStripRename(target: StripRenameTarget): void {
  pending = target;
  for (const listener of listeners) listener();
}

/** Take the pending request, clearing it — a request is consumed once. */
export function takeStripRenameRequest(): StripRenameTarget | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribeStripRename(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
