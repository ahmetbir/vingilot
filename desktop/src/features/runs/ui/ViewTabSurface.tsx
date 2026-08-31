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
// `FileViewer` the Files pane was built around, `HistoryPanel` for a graph, and
// — since P4.6 — one `DiffTab` for both a commit's patch and a worktree's
// changes. Those two were separate components (`Patch` and
// `WorktreeDiffPanel`), which is how the same reading came to have two
// headers, two file lists and two answers about folding. They are one reading
// with different provenance, and `DiffTab.tsx`'s header says so; the *dock*
// keeps `WorktreeDiffPanel`, which is the browsing surface that reading was
// always the wrong size for.

import * as React from "react";

import { patchWrapsAt } from "@/features/runs/lib/diffLayout";
import { readFile } from "@/features/runs/lib/filesClient";
import { readCommitDiff } from "@/features/runs/lib/historyClient";
import {
  commitPatchNote,
  commitSubject,
  type CommitPatch,
} from "@/features/runs/lib/historyModel";
import type { PaneAct } from "@/features/runs/lib/paneModel";
import type { ViewTab } from "@/features/runs/lib/viewTabs";
import { viewTitle } from "@/features/runs/lib/viewTabs";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import {
  diffSummary,
  type WorktreeDiff,
} from "@/features/runs/lib/worktreeDiff";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import type { Worktree } from "@/features/runs/lib/projects";
import { HistoryPanel } from "@/features/runs/ui/DockHistoryPanel";
import { DiffTab, type DiffProvenance } from "@/features/runs/ui/DiffTab";
import {
  FileViewer,
  NOTHING_OPEN,
  type ViewState,
} from "@/features/runs/ui/FileViewer";

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
        <CommitView cwd={cwd} hash={tab.subject.hash} worktree={worktree} />
      ) : tab.subject.kind === "history" ? (
        // **The same panel the dock draws, in a box that can hold the graph**
        // (redesign P4.3). Not a second History component: the scope decision
        // is made from the measured width, so one component gives the dock a
        // scannable first-parent list and gives this surface every branch.
        // `tabbed` only removes the door that leads here.
        <HistoryPanel cwd={cwd} onPaneAct={onPaneAct} tabbed />
      ) : worktree === null ? (
        // The diff is a reading OF a worktree row — its base, its freshness and
        // its branch all come from one. A tab that outlived the row it was
        // opened from says so rather than drawing an empty diff.
        <p
          className="flex flex-1 items-center justify-center px-6 py-4 text-center text-sm text-foreground/70"
          data-testid="view-tab-no-worktree"
        >
          This diff was opened from a worktree this workspace no longer lists,
          so there is nothing left for git to compare.
        </p>
      ) : (
        <WorktreeView
          base={tab.subject.base}
          branch={worktree.branch}
          bindingId={worktree.binding_id}
          cwd={cwd}
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

type Reading<T> =
  | { status: "reading" }
  | { status: "read"; answer: T }
  | { status: "refused"; note: string };

/** The surface's own width, because whether two columns fit is a question in
 * pixels and no class name can express it. The same `ResizeObserver` shape
 * every other patch surface in this island uses. */
function useMeasured(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;
    setWidth(box.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setWidth(measured);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** What a reading that is not an answer draws — the two sentences every read on
 * this island is allowed to say while it has none. */
function Waiting({ state }: { state: Reading<unknown> }) {
  if (state.status === "reading") {
    return (
      <p
        className="flex flex-1 items-center justify-center px-6 py-4 text-sm text-foreground/70"
        data-testid="view-tab-reading"
      >
        reading…
      </p>
    );
  }
  return (
    <p
      className="flex flex-1 items-center justify-center whitespace-pre-wrap px-6 py-4 text-center text-sm text-destructive"
      data-testid="view-tab-refused"
    >
      {state.status === "refused" ? state.note : ""}
    </p>
  );
}

/** One commit's patch, on the diff surface.
 *
 * The provenance is the commit record git already answered with — its subject,
 * its author, its `%aI` date, its short hash and the refs that point at it.
 * Nothing is derived that git did not say: a commit with no refs draws no
 * branch chip. */
function CommitView({
  cwd,
  hash,
  worktree,
}: {
  cwd: string;
  hash: string;
  worktree: Worktree | null;
}) {
  const [state, setState] = React.useState<Reading<CommitPatch>>({
    status: "reading",
  });
  const [ref, width] = useMeasured();

  React.useEffect(() => {
    let alive = true;
    setState({ status: "reading" });
    void readCommitDiff(cwd, hash).then((answered) => {
      if (!alive) return;
      setState(
        answered.ok
          ? { answer: answered.value, status: "read" }
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

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={ref}>
      {state.status !== "read" ? (
        <Waiting state={state} />
      ) : (
        <DiffTab
          bindingId={worktree?.binding_id ?? null}
          cwd={cwd}
          diff={state.answer.diff}
          paneWidth={width}
          provenance={commitProvenance(state.answer)}
          testid="diff-tab-commit"
          wraps={patchWrapsAt(width)}
        />
      )}
    </div>
  );
}

function commitProvenance(answer: CommitPatch): DiffProvenance {
  const commit = answer.commit;
  // git's `%D` writes the ref HEAD is on as `HEAD -> name`; the chip wants the
  // name. A commit nothing points at gets no chip, which is most of them.
  const ref = commit.refs.find((name) => name.startsWith("HEAD -> "));
  const branch =
    ref !== undefined ? ref.slice("HEAD -> ".length) : (commit.refs[0] ?? null);
  return {
    author: commit.author === "" ? null : commit.author,
    branch,
    date: commit.date === "" ? null : commit.date,
    note: commitPatchNote(answer),
    sha: commit.short === "" ? null : commit.short,
    subject: commitSubject(commit),
  };
}

/** This worktree's uncommitted changes, on the same surface.
 *
 * **The header says less, because less is true.** There is no author, no
 * commit time and no sha — these changes have not been committed — so those
 * three are `null` and the header draws the subject, the branch and the counts.
 * The mockup's own meta row is a commit's; putting a name and a hash over a
 * working tree would be this surface inventing provenance. */
function WorktreeView({
  base,
  bindingId,
  branch,
  cwd,
}: {
  base: string;
  bindingId: string;
  branch: string | null;
  cwd: string;
}) {
  const [state, setState] = React.useState<Reading<WorktreeDiff>>({
    status: "reading",
  });
  const [ref, width] = useMeasured();

  React.useEffect(() => {
    let alive = true;
    setState({ status: "reading" });
    void gitWorktreeDiff(cwd, base).then((answered) => {
      if (!alive) return;
      setState(
        answered.ok
          ? { answer: answered.value, status: "read" }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    });
    return () => {
      alive = false;
    };
  }, [base, cwd]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={ref}>
      {state.status !== "read" ? (
        <Waiting state={state} />
      ) : (
        <DiffTab
          bindingId={bindingId}
          cwd={cwd}
          diff={state.answer}
          paneWidth={width}
          provenance={{
            author: null,
            branch: branch === null || branch === "" ? null : branch,
            date: null,
            // What was left out of the answer entirely — the file caps. Said
            // where it is true, which is above the cards.
            note: diffSummary(state.answer).omission,
            sha: null,
            subject: `Working tree against ${state.answer.base}`,
          }}
          testid="diff-tab-worktree"
          wraps={patchWrapsAt(width)}
        />
      )}
    </div>
  );
}
