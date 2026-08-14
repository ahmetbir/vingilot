// The one hand-off point between the app sidebar and the workspace screen
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 2).
//
// The workspace's navigation tree (`features/runs/ui/WorkspaceNav.tsx`) is
// rendered by `RunsScreen` — the only component that holds its ~30 props of
// live state — but it *appears* inside `AppSidebar`'s contextual region, which
// is a sibling of `RunsScreen`'s outlet, not an ancestor. Rather than lifting
// that whole state machine (polls, dialogs, signals, selection ordering) into
// something both trees read, the sidebar registers a slot element here and
// `RunsScreen` portals the fully-wired tree into it. Every piece of state
// keeps its owner; only the DOM moves. In particular the auto-select effect's
// ordering over `selectedRepoId`/`selectedWorktreeId` — the riskiest thing a
// state lift could have silently broken (plan §4) — is untouched, because
// nothing about who sets that state changed.
//
// Module-level rather than context, because the two consumers are mounted in
// two different subtrees under no shared fork-owned provider, and threading a
// context through upstream's `AppShell` is exactly the merge-friction this
// island avoids. It holds a DOM element, not community-scoped data, so it does
// not belong in `resetCommunityState()`: the element is unregistered by its
// own ref cleanup whenever the sidebar's pane unmounts, remounts included.

import * as React from "react";

let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Register (or, with `null`, unregister) the sidebar's workspace slot.
 * Passed directly as a React ref callback, so React's own mount/unmount
 * ordering is the registration's lifecycle. */
export function setSidebarNavSlot(element: HTMLElement | null): void {
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

/** The slot as `RunsScreen` sees it right now — `null` while the sidebar has
 * no workspace pane on screen, which is `createPortal`'s cue to render
 * nothing rather than throw. */
export function useSidebarNavSlot(): HTMLElement | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}
