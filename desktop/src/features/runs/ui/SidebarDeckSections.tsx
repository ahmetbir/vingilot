// The Deck sidebar's contextual region — since P1.1 (owner veto 4) it opens
// on the mockup's `.side` anatomy, not on accordion headers:
//
// - **Projects first, no header over it** — `WorkspaceNav`, rendered
//   directly. The old "Worktrees" accordion header is gone from the first
//   screen: the mockup's sidebar shows the Projects section itself (each
//   project row with its status dot and its own worktree children), and a
//   fold named "Worktrees" above it was exactly what the owner vetoed.
// - **Chats inline, no header either** — the channel/DM lists render right
//   below Projects, in the mockup's own order (Projects → Channels → Direct
//   messages → me-footer). The body is still the slot element
//   (`shared/lib/sidebarChatsSlot.ts`); `AppSidebar` portals its existing,
//   fully-wired channel fragment into it, so nothing about channels is forked
//   or re-plumbed — the sections inside the fragment carry their own
//   "Channels" / "Direct messages" headers, which are the mockup's.
// - **Files and History live BELOW the mockup anatomy**, as a two-member
//   accordion, both collapsed on first paint. They stay reachable — the plan
//   moves them into P3's dock, and until then a deeper fold is the honest
//   parking spot — but they may not outrank the anatomy the owner drew.
//
// **This is still the ONE element `RunsScreen` portals into the sidebar's
// workspace slot** — `sidebarNavSlot.ts` carries exactly one payload,
// unchanged. The accordion members keep `SidebarAccordionSection`'s contract
// (hidden-not-unmounted bodies, aria pair, testids), so tree expansions and
// list state survive a collapse exactly as before; the only change is which
// members are folds at all. `openId` starts empty — neither deep member is
// open until asked, and `resolveAccordionOpen` still keeps at most one open.
//
// An empty member body is a sentence, never a blank: Files and History say
// "no worktree selected" when the Deck has none, and the Chats slot carries a
// loading sentence that hides the moment the portal fills it.

import * as React from "react";

import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { FileReport } from "@/features/runs/lib/placeMru";
import { SidebarAccordionSection } from "@/features/sidebar/ui/SidebarAccordionSection";
import { setSidebarChatsSlot } from "@/shared/lib/sidebarChatsSlot";
import { SidebarFilesTree } from "@/features/runs/ui/SidebarFilesTree";
import { SidebarHistoryList } from "@/features/runs/ui/SidebarHistoryList";

export function SidebarDeckSections({
  cwd,
  onPaneAct,
  openedFile,
  showHistory,
  worktrees,
}: {
  /** The selected checkout's directory, or `null` while the Deck has none. */
  cwd: string | null;
  onPaneAct: (act: PaneAct) => void;
  /** The Files pane's `file-opened` report, for the tree's highlight. */
  openedFile: FileReport | null;
  showHistory: () => void;
  /** The fully-wired `WorkspaceNav`, composed by `RunsScreen` — every prop
   * stays that screen's live state, exactly as the single-sidebar plan
   * arranged. */
  worktrees: React.ReactNode;
}) {
  // Neither deep member open on first paint (P1.1): the first screen is the
  // mockup's anatomy, and Files/History are the deeper fold under it.
  const [openId, setOpenId] = React.useState("");

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

      {/* The deeper fold — below the mockup anatomy, both shut by default. */}
      <div
        className="mt-2 flex w-full flex-col"
        data-testid="sidebar-deck-accordion"
      >
        <SidebarAccordionSection
          id="files"
          onOpenChange={setOpenId}
          openId={openId}
          title="Files"
        >
          {cwd === null ? (
            <NoWorktree what="a file tree" />
          ) : (
            <SidebarFilesTree
              cwd={cwd}
              key={cwd}
              onPaneAct={onPaneAct}
              openedFile={openedFile}
            />
          )}
        </SidebarAccordionSection>

        <SidebarAccordionSection
          id="history"
          onOpenChange={setOpenId}
          openId={openId}
          title="History"
        >
          {cwd === null ? (
            <NoWorktree what="source control and history" />
          ) : (
            <SidebarHistoryList
              active={openId === "history"}
              cwd={cwd}
              key={cwd}
              showHistory={showHistory}
            />
          )}
        </SidebarAccordionSection>
      </div>
    </div>
  );
}

/** The empty read, said: these two members are scoped to a checkout, and the
 * Deck may not have one selected yet. */
function NoWorktree({ what }: { what: string }) {
  return (
    <p
      className="select-none px-4 py-3 text-sm text-muted-foreground/80"
      data-testid="sidebar-accordion-no-worktree"
    >
      No worktree selected — pick one under Projects to see {what}.
    </p>
  );
}
