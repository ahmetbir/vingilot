// The History pane: the shared patch box, at full pane width — and nothing
// else (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4;
// the lists' move out in vingilot/docs/plans/2026-08-14-pane-nav-absorb.md,
// Task 5).
//
// **The lists left, honestly; the patch box did not fork.** Source control
// and the commit log live in the Deck sidebar's History accordion member now
// (`SidebarHistoryList.tsx`) — the status/log lists, the `Older` paging, the
// Reread control and the `j`/`k` cursor all moved with them, removed here
// rather than hidden. What stays is the half Task 4 forbade forking by name:
// one `PatchView` that a commit's patch and a status file's patch both land
// in, drawn by the same renderer the Diff pane draws with. A pick in the
// sidebar files a target (`lib/historyTarget.ts`) and this pane consumes it —
// for its own checkout only — exactly the way the Files pane consumes
// `filesTarget.ts`.
//
// **The keyboard's single owner is the sidebar list, stated plainly** (plan
// §3.3, self-review's "most likely to be got wrong quietly"): the window-level
// `j`/`k` listener this pane used to bind is DELETED, not moved and not
// duplicated — with the rows gone there is nothing left here for a cursor to
// walk, so a keystroke has exactly one listener and it is the sidebar's own
// scoped handler.
//
// **Nothing in this pane writes, and there is no control here that could.**
// The plan drew the line at reading and `workspace-history.spec.ts` still
// scans every control — in the pane and in the sidebar-hosted list — for
// mutating verbs.
//
// **Reads stay honest across the split.** Superseded patch answers are
// dropped on the same counter as before; the HEAD-diff cache is now keyed by
// the sidebar's status generation (`historyTarget.ts`'s header carries the
// invariant), so a Reread over there retires the cache over here, and a
// refusal is still never cached — the next pick asks git again.

import * as React from "react";

import { patchWrapsAt, splitFitsAt } from "@/features/runs/lib/diffLayout";
import { effectiveDiffMode } from "@/features/runs/lib/diffMode";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import { readCommitDiff } from "@/features/runs/lib/historyClient";
import {
  missingPatchNote,
  STATUS_BASE,
  type StatusEntry,
  statusPatch,
} from "@/features/runs/lib/historyModel";
import {
  type HistoryRequest,
  historyShouldLand,
  pendingHistoryPatch,
  subscribeHistoryTarget,
  takeHistoryPatch,
} from "@/features/runs/lib/historyTarget";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { Patch, type PatchState } from "@/features/runs/ui/HistoryPatch";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

export function HistoryPane({ cwd }: PaneProps) {
  // `historyAvailability` has already refused a worktree with no directory, so
  // the frame is showing a sentence rather than this component. The guard is
  // for the type, and for the frames in between.
  if (cwd === null) return null;
  // No `key` here, deliberately, for the reason `SearchPane.tsx` gives: the
  // remount per checkout is `paneRegistry.tsx`'s `identity: ofWorktree`, which
  // is one guard in the place that is tested.
  return <HistoryBody cwd={cwd} />;
}

function HistoryBody({ cwd }: { cwd: string }) {
  const [patch, setPatch] = React.useState<PatchState>({ status: "none" });

  // This pane's own width, because the split toggle's floor and the wrap
  // decision are pixels (`diffLayout.ts`) and no class name can express them.
  // A layout effect so the first paint is already the right shape.
  const paneRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
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

  // The HEAD diff a status row's patch is taken out of, read once per status
  // generation and kept — up to one `git diff` per changed file, so asking
  // again for every pick would spend that on every click. Keyed by the
  // sidebar's status generation: a Reread over there stamps later picks with
  // a fresher generation, which this cache does not answer (the invariant
  // that used to be `readTheStatus` emptying a ref, restated for the split).
  const headDiff = React.useRef<{
    generation: number;
    read: Awaited<ReturnType<typeof gitWorktreeDiff>>;
  } | null>(null);

  // **Superseded answers are dropped, the way `WorktreeDiffPanel` drops
  // them.** One counter over both readers, because both end in `setPatch`.
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const patchRead = React.useRef(0);

  const openCommit = React.useCallback(
    async (hash: string) => {
      const mine = patchRead.current + 1;
      patchRead.current = mine;
      setPatch({ status: "reading" });
      const answered = await readCommitDiff(cwd, hash);
      if (patchRead.current !== mine || !alive.current) return;
      setPatch(
        answered.ok
          ? { answer: answered.value, status: "commit" }
          : {
              note: explainWorktreeError(answered.error).message,
              status: "refused",
            },
      );
    },
    [cwd],
  );

  const openStatusFile = React.useCallback(
    async (entry: StatusEntry, generation: number) => {
      const mine = patchRead.current + 1;
      patchRead.current = mine;
      setPatch({ status: "reading" });
      const cached =
        headDiff.current !== null && headDiff.current.generation === generation
          ? headDiff.current.read
          : null;
      const read = cached ?? (await gitWorktreeDiff(cwd, STATUS_BASE));
      if (patchRead.current !== mine || !alive.current) return;
      if (!read.ok) {
        // **Not cached.** Only an answer is worth keeping: a refusal written
        // into the cache would be replayed for every later pick, so one
        // transient failure — a lock file, a checkout gone for a moment —
        // would read as the pane being broken. The next pick asks git again.
        setPatch({
          note: explainWorktreeError(read.error).message,
          status: "refused",
        });
        return;
      }
      headDiff.current = { generation, read };
      const found = statusPatch(read.value, entry);
      setPatch(
        found === null
          ? { note: missingPatchNote(entry), status: "refused" }
          : { file: found, status: "file" },
      );
    },
    [cwd],
  );

  // The door from the sidebar (plan §3.1) — pending-then-subscribe, the Files
  // pane's exact sequence: the sidebar files the target and THEN brings this
  // pane forward, so a request may already be waiting on mount.
  const land = React.useCallback(
    (request: HistoryRequest) => {
      if (request.pick.kind === "commit") {
        void openCommit(request.pick.commit.hash);
        return;
      }
      void openStatusFile(request.pick.entry, request.pick.statusGeneration);
    },
    [openCommit, openStatusFile],
  );
  React.useEffect(() => {
    const pending = pendingHistoryPatch();
    if (pending !== null && historyShouldLand(pending, cwd)) {
      takeHistoryPatch();
      land(pending);
    }
    return subscribeHistoryTarget((request) => {
      if (!historyShouldLand(request, cwd)) return;
      takeHistoryPatch();
      land(request);
    });
  }, [cwd, land]);

  // The app's one diff-layout flag, read here exactly as the Diff pane reads
  // it — same store, same width precondition. Two panes, one answer.
  const mode = effectiveDiffMode(useDiffMode(), splitFitsAt(paneWidth));
  // The split floor is the only width question left — the list this pane used
  // to measure itself against lives in the sidebar now, so the patch box has
  // the pane whole, at every width.
  const wraps = patchWrapsAt(paneWidth);

  return (
    <section
      className="flex h-full min-h-0 flex-col outline-none"
      data-testid="pane-history"
      ref={paneRef}
      tabIndex={-1}
    >
      <div className="flex min-h-0 flex-1">
        <Patch mode={mode} paneWidth={paneWidth} state={patch} wraps={wraps} />
      </div>
    </section>
  );
}
