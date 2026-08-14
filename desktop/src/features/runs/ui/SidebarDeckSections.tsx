// The Deck sidebar's contextual region: one single-open accordion, four
// members (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md §2.2, plus the
// owner's Chats amendment).
//
// **This is the ONE element `RunsScreen` portals into the sidebar's workspace
// slot** — `sidebarNavSlot.ts` still carries exactly one payload, unchanged,
// which is why it did not become a keyed registry (plan §5). The accordion
// composes here rather than inside `SidebarContextualPane` because three of
// its four bodies are wired to `RunsScreen`'s live state (the worktree tree's
// ~30 props, the Files tree's `cwd`/`onPaneAct`, the History list's reads),
// and the portal already exists precisely so that state never has to leave
// its owner.
//
// The four members, in the vertical order he reads them:
//
// - **Worktrees** — `WorkspaceNav`, exactly as before, now one member's body
//   instead of the whole region. Default open: nothing changes on first load.
// - **Files** — the tree that used to live inside `FilesPane`
//   (`SidebarFilesTree.tsx`), keyed by the selected checkout so its scope
//   follows a worktree switch live — including one made while Worktrees is
//   collapsed, the plan's own riskiest sequence (§8).
// - **History** — the status+commit lists that used to live inside
//   `HistoryPane` (`SidebarHistoryList.tsx`), same key, same reason.
// - **Chats** — the owner's amendment: the channel/DM lists, right here on
//   the Deck. The body is a slot element (`shared/lib/sidebarChatsSlot.ts`);
//   `AppSidebar` portals its existing, fully-wired channel fragment into it,
//   so nothing about channels is forked or re-plumbed. Collapsed by default.
//
// **Vertical model** (plan §2.1–2.2, his "umarim guzelce yapilabilir"): four
// sticky ~32px headers plus ONE open body inside the sidebar's one scroll
// container. At an 800px laptop the open body gets the same budget the
// worktree tree alone had before; the other members cost three header rows,
// never a second column and never a second scroll region. Collapsing and
// expanding is the only motion, and it is always the member he clicked.
//
// An empty member body is a sentence, never a blank (plan §7): Files and
// History say "no worktree selected" when the Deck has none, and the Chats
// slot carries a loading sentence that hides the moment the portal fills it.

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
  // Worktrees open by default — the tree the region has always led with.
  const [openId, setOpenId] = React.useState("worktrees");

  return (
    <div className="flex w-full flex-col" data-testid="sidebar-deck-accordion">
      <SidebarAccordionSection
        id="worktrees"
        onOpenChange={setOpenId}
        openId={openId}
        title="Worktrees"
      >
        {worktrees}
      </SidebarAccordionSection>

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

      <SidebarAccordionSection
        id="chats"
        onOpenChange={setOpenId}
        openId={openId}
        title="Chats"
      >
        {/* The slot AppSidebar portals the channel/DM lists into. `peer` +
            `peer-empty` keep the empty read a sentence: while nothing has
            been portalled yet (the channel list still loading), the member
            says so instead of rendering a blank. */}
        <div
          className="peer flex w-full flex-col"
          data-testid="sidebar-chats-slot"
          ref={setSidebarChatsSlot}
        />
        <p className="hidden select-none px-4 py-3 text-sm text-muted-foreground/80 peer-empty:block">
          Loading channels…
        </p>
      </SidebarAccordionSection>
    </div>
  );
}

/** The empty read, said (plan §7): these two members are scoped to a
 * checkout, and the Deck may not have one selected yet. */
function NoWorktree({ what }: { what: string }) {
  return (
    <p
      className="select-none px-4 py-3 text-sm text-muted-foreground/80"
      data-testid="sidebar-accordion-no-worktree"
    >
      No worktree selected — pick one under Worktrees to see {what}.
    </p>
  );
}
