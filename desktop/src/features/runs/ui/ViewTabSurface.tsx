// What a view tab draws when it is the one showing — a file, a commit's
// patch, or the worktree's diff, on the whole stage (redesign P4.1, items 3
// and 4).
//
// **This is P3.1's geometry ruling, answered.** A diff that needs room was
// getting a 540px dock card, because the dock is where the diff lived. The
// dock is the right home for *browsing* — a list of changed files, a tree, a
// commit log — and the wrong one for *reading*, and the owner's own answer was
// to put the reading in the terminal's tab strip. So this component renders
// inside the terminal pane's body, which is the stage: at the default layout
// it is more than twice the dock's width, and ⌥⌘B gives it the window.
//
// **It never touches a pty.** The terminals it renders beside are mounted and
// un-laid-out while a view shows — the state a background tab is already in
// (`WorkSurface.tsx`'s header on why terminals may not change parents). This
// component has no access to a session id, spawns nothing, and closes nothing.
//
// **Each kind reuses the surface that already knows how to draw it**: the
// `FileViewer` the Files pane was built around, the shared `Patch` box the
// History surfaces render commits through, and `WorktreeDiffPanel` itself. A
// second drawing of a patch would be a second set of answers about wrapping,
// split mode and syntax, and the two would drift.

import * as React from "react";

import { patchWrapsAt, splitFitsAt } from "@/features/runs/lib/diffLayout";
import { effectiveDiffMode } from "@/features/runs/lib/diffMode";
import { readFile } from "@/features/runs/lib/filesClient";
import { readCommitDiff } from "@/features/runs/lib/historyClient";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { ViewTab } from "@/features/runs/lib/viewTabs";
import { viewTitle } from "@/features/runs/lib/viewTabs";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import type { Worktree } from "@/features/runs/lib/projects";
import {
  FileViewer,
  NOTHING_OPEN,
  type ViewState,
} from "@/features/runs/ui/FileViewer";
import { Patch, type PatchState } from "@/features/runs/ui/HistoryPatch";
import { WorktreeDiffPanel } from "@/features/runs/ui/WorktreeDiffPanel";

export function ViewTabSurface({
  cwd,
  onPaneAct,
  tab,
  worktree,
}: {
  /** The checkout every read below is made in. */
  cwd: string;
  /** A file row inside the diff goes out through the workspace's existing
   * `show-file` act — which files the target and brings the dock's Files tree
   * to it, and the tree opens the tab. One route from every surface, rather
   * than a second one that only this copy of the diff would have. */
  onPaneAct: (act: PaneAct) => void;
  tab: ViewTab;
  worktree: Worktree | null;
}) {
  return (
    // Keyed by the tab so switching between two open files is a fresh read of
    // the one asked for rather than the previous file's state being pointed at
    // a new path — `WorkSurface`'s own `${pane}:${identity}` discipline.
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid={`view-tab-surface-${tab.id}`}
      data-view-kind={tab.subject.kind}
      key={tab.id}
      title={viewTitle(tab.subject)}
    >
      {tab.subject.kind === "file" ? (
        <FileView cwd={cwd} line={tab.subject.line} path={tab.subject.path} />
      ) : tab.subject.kind === "commit" ? (
        <CommitView cwd={cwd} hash={tab.subject.hash} />
      ) : worktree === null ? (
        // The diff panel is a reading OF a worktree row — its base, its
        // freshness and its branch all come from one. A tab that outlived the
        // row it was opened from says so rather than drawing an empty diff.
        <p
          className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-foreground/70"
          data-testid="view-tab-no-worktree"
        >
          This diff was opened from a worktree this workspace no longer lists,
          so there is nothing left for git to compare.
        </p>
      ) : (
        <WorktreeDiffPanel
          cwd={cwd}
          onShowFile={(path, line) =>
            onPaneAct({ line, path, type: "show-file", worktree: cwd })
          }
          worktree={worktree}
        />
      )}
    </div>
  );
}

/** One file, read once per (path, line) the tab was opened with.
 *
 * The read discipline is `FilesPane.tsx`'s, kept: a superseded answer is
 * dropped on the echoed path, so a fast click through a tree cannot land an
 * older file's text under a newer file's name. */
function FileView({
  cwd,
  line,
  path,
}: {
  cwd: string;
  line: number | null;
  path: string;
}) {
  const [state, setState] = React.useState<ViewState>(NOTHING_OPEN);
  const paneRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let alive = true;
    setState({ path, status: "reading" });
    void readFile(cwd, path).then((answered) => {
      if (!alive) return;
      setState(
        answered.ok
          ? { file: answered.value, line, status: "read" }
          : { error: answered.error, path, status: "refused" },
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd, path, line]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" ref={paneRef}>
      <FileViewer cwd={cwd} paneRef={paneRef} state={state} />
    </div>
  );
}

/** One commit's patch, in the shared `Patch` box.
 *
 * No back affordance: the tab strip is the way out of a tab, and a second
 * "‹ back" inside one would be a control that means something different from
 * the ✕ two pixels above it. `Patch` already makes `onBack` optional for
 * exactly this. */
function CommitView({ cwd, hash }: { cwd: string; hash: string }) {
  const [state, setState] = React.useState<PatchState>({ status: "reading" });
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState({ status: "reading" });
    void readCommitDiff(cwd, hash).then((answered) => {
      if (!alive) return;
      setState(
        answered.ok
          ? { answer: answered.value, status: "commit" }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    });
    return () => {
      alive = false;
    };
  }, [cwd, hash]);

  // The patch box's width machinery, shared with every other surface that
  // renders one: whether a split fits is a question in pixels.
  React.useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane === null) return;
    setPaneWidth(pane.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setPaneWidth(measured);
    });
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);

  const mode = effectiveDiffMode(useDiffMode(), splitFitsAt(paneWidth));

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={paneRef}>
      <Patch
        mode={mode}
        paneWidth={paneWidth}
        state={state}
        wraps={patchWrapsAt(paneWidth)}
      />
    </div>
  );
}
