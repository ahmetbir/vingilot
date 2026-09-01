// **The pane the owner actually looks at** — the sidebar's `/projects` view
// (vingilot/docs/plans/2026-08-29-redesign.md, P5).
//
// The mockup puts `#view-prs` on the stage, in a full-width column with a
// `.vhead`, an Open/Merged/All tab row and a list of `.prrow`s. The stage on
// `/projects` belongs to upstream's own projects screen, so this fork's pull
// requests live where the owner asked for them: in the one sidebar, under the
// Pull requests menu row. Everything else about the mockup is kept — the head
// with its title and its `repo · N open` sub-line, the bordered rows, the
// branch chips, the detail with its back row.
//
// **Three things the mockup draws are not drawn, and each for the same
// reason.** The `.prtabs` row ("Open 3 / Merged 12 / All") counts pull requests
// nobody asked GitHub for: `pulls_list` lists *open* ones, so a Merged tab
// would carry a number this build made up. The `.prright` rail (CI tick,
// comment count, reviewer avatars) has no field behind it. The detail's
// Commits/Checks cards likewise. Every one of them is absent rather than empty,
// because an empty "Checks" card is itself a claim.
//
// **Which repository this is about comes from the workspace, not from here.**
// `RunsScreen` publishes the checkout it has selected
// (`shared/lib/worktreeFocus.ts`) and this pane reads it; switching worktree in
// the Deck moves this list to that repository. When nothing has ever been
// selected the pane says exactly that — it does not pick a repository to be
// helpful.
//
// **Loading is a state.** `gh` is a subprocess against a network with a
// 20-second deadline; for those seconds "not answered yet" and "no pull
// requests" are different facts, so the wait says it is a wait
// (`lib/usePullsRead.ts`), and a failure leaves a sentence rather than the
// empty list that would read as "none".

import * as React from "react";

import type { PullList } from "@/features/pulls/lib/pullsAnswer";
import type { PullsRead } from "@/features/pulls/lib/usePullsRead";
import { usePullDetail, usePullsList } from "@/features/pulls/lib/usePullsRead";
import { listSummary } from "@/features/pulls/lib/pullsCopy";
import { PullDetailView } from "@/features/pulls/ui/PullDetailView";
import { PullsList } from "@/features/pulls/ui/PullsList";
import { PullsRefusalNotice } from "@/features/pulls/ui/PullsRefusalNotice";
import { useWorktreeFocus } from "@/shared/lib/worktreeFocus";

/** One sentence, the pane's own voice — used for the two states that are not a
 * read at all (nothing selected, and a read still out). */
function PaneSentence({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <p
      className="text-pretty px-1 py-1 text-2xs leading-relaxed text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </p>
  );
}

/** The back row for the detail states that have no detail to draw — a refusal
 * or a wait. `PullDetailView` draws its own; only one is ever on screen. */
function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <button
      className="-ml-1.5 inline-flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-2xs text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      data-act="pr-back"
      data-testid="pull-detail-back"
      onClick={onBack}
      type="button"
    >
      <svg
        aria-hidden="true"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      All pull requests
    </button>
  );
}

/** The `.vhead` sub-line. `null` whenever no true count exists — a refusal is
 * described by its own sentence in the body, not summarised in the head. */
function summaryLine(
  read: PullsRead<PullList> | null,
  repoName: string,
): string | null {
  if (read === null) return null;
  if (read.phase === "loading") {
    return repoName === "" ? "reading…" : `${repoName} · reading…`;
  }
  if (read.answer.kind !== "answer") return null;
  return listSummary(
    read.answer.repo,
    read.answer.pulls.length,
    read.answer.more,
    read.answer.cap,
  );
}

export function PullsPane() {
  const focus = useWorktreeFocus();
  const path = focus?.path ?? null;
  // **A pull request number belongs to the checkout it was opened from**, so
  // the open one is held *with* its path rather than reset by an effect when
  // the path changes. When the workspace moves to another worktree, the stored
  // `#412` stops matching and the pane is back on the list on the very first
  // render — there is no frame in which one repository's number is asked about
  // another repository.
  const [opened, setOpened] = React.useState<{
    number: number;
    path: string;
  } | null>(null);
  const open = opened !== null && opened.path === path ? opened.number : null;

  const [list, readListAgain] = usePullsList(path);
  const [detail, readDetailAgain] = usePullDetail(path, open);
  const back = React.useCallback(() => setOpened(null), []);
  const openPull = React.useCallback(
    (number: number) => {
      if (path !== null) setOpened({ number, path });
    },
    [path],
  );

  const summary = summaryLine(list, focus?.repoName ?? "");

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-2 px-2 pb-3 pt-1"
      data-testid="pulls-pane"
      data-worktree={path ?? ""}
    >
      {/* The mockup's `.vhead`. */}
      <div className="flex flex-wrap items-baseline gap-x-2 px-1 pt-1">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Pull requests
        </span>
        {summary === null ? null : (
          <span
            className="text-2xs text-muted-foreground"
            data-testid="pulls-summary"
          >
            {summary}
          </span>
        )}
      </div>

      <PullsPaneBody
        detail={detail}
        list={list}
        onBack={back}
        onOpen={openPull}
        onRetryDetail={readDetailAgain}
        onRetryList={readListAgain}
        open={open}
      />
    </div>
  );
}

function PullsPaneBody({
  detail,
  list,
  onBack,
  onOpen,
  onRetryDetail,
  onRetryList,
  open,
}: {
  detail: ReturnType<typeof usePullDetail>[0];
  list: ReturnType<typeof usePullsList>[0];
  onBack: () => void;
  onOpen: (number: number) => void;
  onRetryDetail: () => void;
  onRetryList: () => void;
  open: number | null;
}) {
  // Nothing has ever been selected — not a read, and not a refusal either.
  if (list === null) {
    return (
      <PaneSentence testId="pulls-no-worktree">
        No checkout is selected. Open a project in the Workspace and its
        repository's pull requests appear here.
      </PaneSentence>
    );
  }

  if (open !== null) {
    if (detail === null || detail.phase === "loading") {
      return (
        <div className="flex flex-col gap-2">
          <BackRow onBack={onBack} />
          <PaneSentence testId="pull-detail-loading">
            Reading pull request #{open} from GitHub…
          </PaneSentence>
        </div>
      );
    }
    if (detail.answer.kind !== "answer") {
      return (
        <div className="flex flex-col gap-2">
          <BackRow onBack={onBack} />
          <PullsRefusalNotice onRetry={onRetryDetail} refusal={detail.answer} />
        </div>
      );
    }
    return <PullDetailView detail={detail.answer} onBack={onBack} />;
  }

  if (list.phase === "loading") {
    return (
      <PaneSentence testId="pulls-loading">
        Reading this repository's open pull requests from GitHub…
      </PaneSentence>
    );
  }
  if (list.answer.kind !== "answer") {
    return <PullsRefusalNotice onRetry={onRetryList} refusal={list.answer} />;
  }
  return <PullsList list={list.answer} onOpen={onOpen} />;
}
