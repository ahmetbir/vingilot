// The workspace's runs, as a pane (`ui/paneRegistry.tsx`) — the pre-existing
// RunList + DeckPane/RunDetail pair, unchanged. "Run rows do not disappear —
// they become a tab, not the front door"
// (vingilot/docs/plans/2026-08-06-projects-and-terminal.md); they are now a
// pane rather than a tab, and still do not disappear.
//
// It opens on the run that owns the worktree the owner is standing in, which
// is the only run he has already said he cares about.
//
// **This is the pane that fits the host worst, and it is worth saying why.**
// The other three are one surface each; this one is a master/detail pair, so
// putting it in half a split makes four columns on screen and gives the detail
// side whatever is left of a half. Nothing here bends to hide that — the list
// takes half the pane rather than a fixed width, which keeps both sides
// readable, and the rest is the honest shape of the thing. What it says about
// the host is that a pane wants to be *one* surface: a future pane with its own
// two columns is a sign that it is really two panes.

import * as React from "react";

import { DeckPane } from "@/features/runs/ui/DeckPane";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";
import { RunDetail } from "@/features/runs/ui/RunDetail";
import { RunList } from "@/features/runs/ui/RunList";

export function RunsPane({
  ownerRunId,
  reachable,
  runs,
  workspaceId,
}: PaneProps) {
  const [selectedRunId, setSelectedRunId] = React.useState(ownerRunId);

  // The worktree underneath this pane can change (a different worktree
  // selected while Runs stays on the right) — re-sync to that worktree's own
  // owner run rather than showing a stale one.
  React.useEffect(() => {
    setSelectedRunId(ownerRunId);
  }, [ownerRunId]);

  const openRun = React.useCallback((id: string) => setSelectedRunId(id), []);
  const openDeck = React.useCallback(() => setSelectedRunId(null), []);

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      data-testid="pane-runs"
    >
      <aside
        aria-label="runs"
        // Half the pane, capped — not a fixed 224px. This is the surface that
        // ports worst onto a pane (see the note above): it is a master/detail
        // of its own, and a fixed list width inside a pane the owner can drag
        // narrow leaves the detail side at zero.
        className="flex w-1/2 max-w-56 min-w-0 shrink-0 flex-col overflow-hidden border-r border-border/60"
      >
        <RunList
          activeRunId={selectedRunId}
          onSelectDeck={openDeck}
          onSelectRun={openRun}
          runs={runs}
          workspaceId={workspaceId}
        />
      </aside>
      <main
        aria-label="workspace"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {selectedRunId === null ? (
          <DeckPane
            onOpenRun={openRun}
            reachable={reachable}
            runs={runs}
            workspaceId={workspaceId}
          />
        ) : (
          <RunDetail key={selectedRunId} runId={selectedRunId} />
        )}
      </main>
    </div>
  );
}
