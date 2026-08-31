// The Deck sidebar's contextual region: the mockup's `.side` anatomy, and
// since P4.1 nothing else.
//
// - **Projects first, no header over it** — `WorkspaceNav`, rendered
//   directly. The old "Worktrees" accordion header is gone from the first
//   screen (P1.1, owner veto 4): the mockup's sidebar shows the Projects
//   section itself (each project row with its status dot and its own worktree
//   children), and a fold named "Worktrees" above it was exactly what the
//   owner vetoed.
// - **Chats inline, no header either** — the channel/DM lists render right
//   below Projects, in the mockup's own order (Projects → Channels → Direct
//   messages → me-footer). The body is still the slot element
//   (`shared/lib/sidebarChatsSlot.ts`); `AppSidebar` portals its existing,
//   fully-wired channel fragment into it, so nothing about channels is forked
//   or re-plumbed — the sections inside the fragment carry their own
//   "Channels" / "Direct messages" headers, which are the mockup's.
//
// **Files and History are gone from here, and that is the whole of P4.1's
// first item**: "sol side bardaki history ve files kalkmali. cok daha iyisi
// sag tarafa yapilacak." P1.1 parked them below the anatomy as a two-member
// accordion because the dock did not exist yet; P3 built the dock, which owns
// both properly — a tree with git letters and a real context menu, a commit
// list with the mockup's lane graph — and P4.1 removed the parked copy. With
// the last two members gone the accordion shell went with them: a fold
// containing nothing is furniture, not an affordance. `SidebarFilesTree.tsx`
// and `SidebarHistoryList.tsx` went too — the dock's panels are not forks of
// them, they are the surfaces those two were a preview of.
//
// **This is still the ONE element `RunsScreen` portals into the sidebar's
// workspace slot** — `sidebarNavSlot.ts` carries exactly one payload,
// unchanged.
//
// An empty read is still a sentence, never a blank: the Chats slot carries a
// loading line that hides the moment the portal fills it.

import type * as React from "react";

import { setSidebarChatsSlot } from "@/shared/lib/sidebarChatsSlot";

export function SidebarDeckSections({
  worktrees,
}: {
  /** The fully-wired `WorkspaceNav`, composed by `RunsScreen` — every prop
   * stays that screen's live state, exactly as the single-sidebar plan
   * arranged. */
  worktrees: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col" data-testid="sidebar-deck-sections">
      {/* Projects — the mockup's section, rendered directly. */}
      {worktrees}

      {/* Chats — the slot AppSidebar portals the channel/DM lists into,
          inline in the mockup's order. `peer` + `peer-empty` keep the empty
          read a sentence: while nothing has been portalled yet (the channel
          list still loading), the member says so instead of rendering a
          blank. */}
      <div
        className="peer flex w-full flex-col"
        data-testid="sidebar-chats-slot"
        ref={setSidebarChatsSlot}
      />
      <p className="hidden select-none px-4 py-3 text-sm text-muted-foreground/80 peer-empty:block">
        Loading channels…
      </p>
    </div>
  );
}
