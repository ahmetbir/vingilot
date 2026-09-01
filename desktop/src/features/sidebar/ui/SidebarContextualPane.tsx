// The sidebar's contextual region — what the lower half of the one sidebar
// shows when the view is not about channels
// (vingilot/docs/plans/2026-08-14-single-sidebar.md, Task 1).
//
// VS Code's model, which is the owner's ask: a fixed top (search + the primary
// menu, `AppSidebarPinnedHeader.tsx`) and one contextual tree under it that
// changes with where he is. `AppSidebar` itself keeps the channel/DM list for
// the views that are about channels (home, channel, messages) and mounts this
// component for every other view; this component owns the switch.
//
// Fork-owned, new — the same arrangement `CommunityRail.tsx` already has in
// this directory: a fork file beside upstream's sidebar files, so the gating
// edit inside `AppSidebar.tsx` stays a dozen lines (that file has no headroom
// against the 1000-line ratchet and is upstream's own growth surface).
//
// Two branches:
//
// - **workspace** — an empty slot element, registered with
//   `shared/lib/sidebarNavSlot.ts`. The tree itself (`WorkspaceNav`) is
//   portalled in by `RunsScreen`, which owns all of its state; see the slot
//   module's header for why the DOM moves and the state does not.
//
// - **projects** — the Pull requests pane (`features/pulls/ui/PullsPane.tsx`),
//   redesign P5. This row used to carry the placeholder sentence "your repos'
//   real pull requests are on their way"; they have arrived, read with `gh`
//   through `vingilot_pulls` for whichever checkout the workspace has
//   selected.
//
// - **agents / pulse / workflows** — a named empty state. These views have no
//   sidebar-shaped content yet, and before this component they showed the
//   channel list instead — not "nothing", a wrong answer standing in for one.
//   "No sidebar detail … yet" is strictly more honest, and it is a sentence
//   rather than an empty box because an empty read must never look like
//   "nothing there" (plan §1.4, §4). Building real trees for these three is
//   explicitly not this component's job.

import type * as React from "react";
import { createPortal } from "react-dom";

import { PullsPane } from "@/features/pulls/ui/PullsPane";
import type { AppSidebarProps } from "@/features/sidebar/ui/AppSidebar.types";
import { useSidebarChatsSlot } from "@/shared/lib/sidebarChatsSlot";
import { setSidebarNavSlot } from "@/shared/lib/sidebarNavSlot";

type SelectedView = AppSidebarProps["selectedView"];

/** Where `AppSidebar`'s channel/DM lists render: inline for the channel-shaped
 * views, or portalled into the Deck accordion's Chats member for the
 * workspace view — the owner's amendment to the pane-nav-absorb plan
 * (*"deckten geri channellari ve dmleri gormek icin agents'a ya da inboxa
 * basmak gerekiyo"*). The fragment is `AppSidebar`'s own, fully wired; only
 * the DOM moves, which is `sidebarNavSlot.ts`'s idiom with the roles
 * reversed (see `shared/lib/sidebarChatsSlot.ts`). This component lives here
 * rather than in `AppSidebar.tsx` so that file's edit stays three lines — it
 * has no headroom against the 1000-line ratchet. */
export function SidebarChatsHome({
  children,
  portal,
}: {
  children: React.ReactNode;
  portal: boolean;
}) {
  const slot = useSidebarChatsSlot();
  if (!portal) return <>{children}</>;
  // No accordion on screen yet (the workspace route is still mounting):
  // render nothing rather than throw — the member's own loading sentence
  // stands in.
  if (slot === null) return null;
  return createPortal(children, slot);
}

/** What each content-less view is called in its empty state's sentence — the
 * primary menu's own labels, so the sentence names the row the owner clicked. */
const EMPTY_VIEW_LABELS: Partial<Record<SelectedView, string>> = {
  agents: "Agents",
  pulse: "Pulse",
  workflows: "Workflows",
};

export function SidebarContextualPane({
  selectedView,
}: {
  selectedView: SelectedView;
}) {
  if (selectedView === "workspace") {
    return (
      <div
        className="flex w-full flex-col"
        data-testid="sidebar-workspace-slot"
        ref={setSidebarNavSlot}
      />
    );
  }

  if (selectedView === "projects") return <PullsPane />;

  const label = EMPTY_VIEW_LABELS[selectedView];
  // The channel views are AppSidebar's own branch, not this component's; a
  // view this component has no answer for renders nothing rather than a
  // sentence about a view it cannot name.
  if (label === undefined) return null;

  return (
    <p
      className="select-none px-4 py-3 text-sm text-muted-foreground/80"
      data-testid="sidebar-contextual-empty"
    >
      {`No sidebar detail for ${label} yet.`}
    </p>
  );
}
