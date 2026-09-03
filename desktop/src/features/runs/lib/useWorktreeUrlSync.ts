// The selected worktree, mirrored into the workspace's URL — so ⌘[ / ⌘] and
// the top chrome's back/forward walk worktrees (2026-09-04).
//
// His brief asked for *"⌘[ / ⌘]: önceki/sonraki worktree geçmişi"*. Those
// chords are already upstream's: `app/navigation/backForwardChords.ts`
// binds them app-wide to the router's history, the same way Safari does,
// and the top chrome's two arrows press the same thing. Claiming them in
// the workspace would silently break that. So instead of a second history
// under a stolen chord, the worktree becomes part of the ONE history: each
// switch pushes `/workspace?wt=<id>`, and going back through it lands on
// the worktree that was there — through upstream's own listener, its own
// arrows, its own navigation guard.
//
// Two directions, one guard. State → URL when he selects (a push, or a
// replace for the first landing so the entry before it is not a workspace
// with nothing in it); URL → state when the router moves (back, forward, a
// link). `mirrored` is what stops the two from answering each other.

import { useNavigate, useSearch } from "@tanstack/react-router";
import * as React from "react";

import type { LandingIndex } from "./homeLanding.ts";

interface WorkspaceSearch {
  wt?: string;
}

export function useWorktreeUrlSync({
  index,
  openWorktree,
  selectedWorktreeId,
}: {
  index: LandingIndex;
  openWorktree: (repoId: string, bindingId: string) => void;
  selectedWorktreeId: string | null;
}): void {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as WorkspaceSearch;
  const urlWt =
    typeof search.wt === "string" && search.wt !== "" ? search.wt : null;
  // The last id this hook itself wrote or read, so an echo is not a move.
  const mirrored = React.useRef<string | null>(null);

  // State → URL.
  React.useEffect(() => {
    if (selectedWorktreeId === null || selectedWorktreeId === urlWt) return;
    if (mirrored.current === selectedWorktreeId) return;
    mirrored.current = selectedWorktreeId;
    void navigate({
      // The first landing replaces: an entry for "the workspace, nothing
      // selected" would be a back-stop he never stood on.
      replace: urlWt === null,
      search: { wt: selectedWorktreeId } as never,
      to: "/workspace",
    });
  }, [selectedWorktreeId, urlWt, navigate]);

  // URL → state.
  React.useEffect(() => {
    if (urlWt === null || urlWt === selectedWorktreeId) return;
    if (mirrored.current === urlWt) return;
    const entry = index.get(urlWt);
    if (entry === undefined) return;
    mirrored.current = urlWt;
    openWorktree(entry.repo.id, urlWt);
  }, [urlWt, selectedWorktreeId, index, openWorktree]);
}
