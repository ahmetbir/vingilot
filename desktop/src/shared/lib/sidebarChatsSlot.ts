// The hand-off point for the Deck sidebar's Chats accordion member — the
// owner's amendment to vingilot/docs/plans/2026-08-14-pane-nav-absorb.md:
//
// > *"deckten geri channellari ve dmleri gormek icin agents'a ya da inboxa
// > basmak gerekiyo. direk chatleri acabilecegim ya da deck sidebarini
// > kapatabilecegim bi buton yok henuz."*
//
// The channel/DM lists (`ChannelGroupSection`, `SidebarSection` and their
// forty-odd props) live in `AppSidebar`'s scope and must not be forked or
// re-plumbed — the amendment says so by name. So this is `sidebarNavSlot.ts`'s
// idiom a second time, with the roles reversed: the accordion (portalled into
// the sidebar by `RunsScreen`) registers a slot element here, and `AppSidebar`
// portals its existing, fully-wired channel fragment into it whenever the
// workspace view is up. Every prop keeps its owner; only the DOM moves.
//
// A second module rather than a key on `sidebarNavSlot` because the two slots
// have two different writers and two different readers, and the single-slot
// module's header explicitly reserves "becoming a keyed registry" for the day
// one mechanism has two payloads — this is two mechanisms with one each.
//
// Module-level, not context, for `sidebarNavSlot.ts`'s reason. It holds a DOM
// element, not community-scoped data, so it does not belong in
// `resetCommunityState()`: the ref callback unregisters it on unmount,
// remounts included.

import * as React from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Register (or, with `null`, unregister) the Chats member's body element.
 * Passed directly as a React ref callback, so React's own mount/unmount
 * ordering is the registration's lifecycle. */
export function setSidebarChatsSlot(element: HTMLElement | null): void {
  if (element === slot) return;
  slot = element;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): HTMLElement | null {
  return slot;
}

/** The slot as `AppSidebar` sees it right now — `null` while no Deck sidebar
 * accordion is on screen, which is `createPortal`'s cue to render nothing
 * rather than throw. */
export function useSidebarChatsSlot(): HTMLElement | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}
