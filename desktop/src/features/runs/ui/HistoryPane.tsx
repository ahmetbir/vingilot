// The History pane: what git already knows about this checkout
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//
// **Source control and history are ONE pane, and the source-control section is
// at the top. Task 4 asked for the call to be made and said out loud, so:**
//
// - They are one question asked at two distances. "What have I not committed"
//   and "what did I commit" are read together — the first is how he decides
//   whether the second is finished — and a pane that answered only one of them
//   would be a pane he opens beside the other.
// - **They share the patch box, and that is the half that would have gone wrong
//   as two panes.** A commit's patch and a status file's patch land in the same
//   `PatchView` here. Two panes means two patch boxes, and two patch boxes is
//   exactly the shape in which someone eventually gives one of them a fix the
//   other does not get — the drift Task 4 forbade by name ("do not fork the
//   patch component"). One pane makes the sharing structural rather than a rule
//   somebody has to remember.
// - The registry cost is real: every pane is a row in ⌘K, a row in the picker
//   and a claim on the layout the owner has to choose between. Two rows for one
//   reading is two decisions where the answer is always "both".
//
// Source control goes above history because it is the half that changes while
// he is looking at it, and because it is the shorter of the two — a scrolling
// list of 200 commits above it would put the four files he actually cares about
// below the fold.
//
// **Nothing in this pane writes, and there is no control here that could.** No
// stage, no unstage, no discard, no commit, no checkout — not hidden, not
// disabled, *absent*. The plan drew the line at reading: showing what would be
// committed is a different promise from committing, the second one has a
// destructive failure mode (a discard is somebody's afternoon), and the terminal
// is one keystroke away in the pane next door. `workspace-history.spec.ts` reads
// every control in this pane and fails on any whose name is a mutating verb, so
// the claim is a test rather than a comment.
//
// **This component holds effects and layout, and no decisions.** What an answer
// means, what each refusal says, which sections exist, what the rows are, what
// the keys do and how the pane divides itself are all in `lib/historyModel.ts`,
// where they are tested with no DOM. The three sections' rendering lives next
// door — `HistoryStatus.tsx`, `HistoryCommits.tsx`, `HistoryPatch.tsx` — split
// out when this file reached the 1000-line ratchet.

import * as React from "react";

import {
  diffListPlacement,
  patchWrapsAt,
  SPLIT_MIN_PX,
  splitFitsAt,
} from "@/features/runs/lib/diffLayout";
import { effectiveDiffMode } from "@/features/runs/lib/diffMode";
import { useDiffMode } from "@/features/runs/lib/useDiffMode";
import {
  activatesOnEnter,
  type FocusedElement,
  isTypingTarget,
  resolveDiffKey,
} from "@/features/runs/lib/diffKeys";
import {
  readCommitDiff,
  readHistory,
  readStatus,
} from "@/features/runs/lib/historyClient";
import {
  appendPage,
  type Commit,
  type HistoryRow,
  historyLayout,
  historyRows,
  type LogState,
  missingPatchNote,
  rowFor,
  STATUS_BASE,
  type StatusEntry,
  statusPatch,
  statusSections,
  type StatusState,
  stepRow,
} from "@/features/runs/lib/historyModel";
import { gitWorktreeDiff } from "@/features/runs/lib/worktreeClient";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { Commits } from "@/features/runs/ui/HistoryCommits";
import { Patch, type PatchState } from "@/features/runs/ui/HistoryPatch";
import { SourceControl } from "@/features/runs/ui/HistoryStatus";
import type { PaneProps } from "@/features/runs/ui/paneRegistry";

/** As much of the focused element as `diffKeys.ts` needs to decide whether a
 * letter is a letter and whether `Enter` belongs to a control. The same helper
 * `WorktreeDiffPanel` keeps, and deliberately a copy of three lines rather than
 * a shared export: it is a reading of `document`, so hoisting it into `diffKeys`
 * would put a DOM in the module whose whole value is being testable without
 * one. */
function focusedElement(): FocusedElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return {
    contentEditable: active.isContentEditable,
    role: active.getAttribute("role"),
    tagName: active.tagName,
  };
}

export function HistoryPane({ cwd }: PaneProps) {
  // `historyAvailability` has already refused a worktree with no directory, so
  // the frame is showing a sentence rather than this component. The guard is for
  // the type, and for the frames in between.
  if (cwd === null) return null;
  // No `key` here, deliberately, for the reason `SearchPane.tsx` gives: the
  // remount per checkout is `paneRegistry.tsx`'s `identity: ofWorktree`, which
  // is one guard in the place that is tested. A second one here would be a
  // defence nothing could tell the absence of.
  return <HistoryBody cwd={cwd} />;
}

function HistoryBody({ cwd }: { cwd: string }) {
  const [log, setLog] = React.useState<LogState>({ status: "idle" });
  const [status, setStatus] = React.useState<StatusState>({ status: "idle" });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [patch, setPatch] = React.useState<PatchState>({ status: "none" });
  const [paging, setPaging] = React.useState(false);
  // A refused *page*, held apart from `log` on purpose: a second page git said
  // no to costs the page and not the two hundred commits already on screen.
  // Folding it into `LogState` would mean the pane has no shape for "these
  // commits, and the older ones could not be read", so it would have to drop one
  // of the two — and the one it dropped would be the history he was reading.
  const [pagingError, setPagingError] = React.useState<string | null>(null);

  // This pane's own width, because who yields to whom is decided in pixels
  // (`diffLayout.ts`) and no class name can express it. A layout effect so the
  // first paint is already the right shape. 0 until measured, which the
  // placement reads as "not measured" and never as "narrow".
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

  // The HEAD diff a status row's patch is taken out of, read once and kept —
  // it is up to one `git diff` per changed file, and asking again for every row
  // he walks past would spend that on every keystroke. Dropped whenever status
  // is re-read, because by then it is a reading of a tree that has moved.
  const headDiff = React.useRef<Awaited<
    ReturnType<typeof gitWorktreeDiff>
  > | null>(null);

  // **Superseded answers are dropped, the way `WorktreeDiffPanel` drops them.**
  // `commit_diff` runs one `git diff` per changed file, so a four-hundred-file
  // commit is slow: click that, then click a small one, and without a guard the
  // small patch renders and the large one's answer then replaces it — leaving
  // the header naming a commit the highlight is not on. `alive` is false only
  // once this pane is really gone, re-armed for the dev build's double mount.
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Which patch read is the current one. **One counter over both readers**,
   * because both end in `setPatch`: a commit clicked while a file's read is in
   * flight has to supersede it, and a counter each would let every read drop
   * only its own kind. */
  const patchRead = React.useRef(0);
  /** And the status read's own, so the mount's read and a `Reread` cannot land
   * out of order. Separate from the patch's on purpose: they write different
   * state, and one shared counter would have a row click cancel a status read. */
  const statusRead = React.useRef(0);

  const readTheStatus = React.useCallback(async () => {
    const mine = statusRead.current + 1;
    statusRead.current = mine;
    setStatus({ status: "reading" });
    headDiff.current = null;
    const answered = await readStatus(cwd);
    if (statusRead.current !== mine || !alive.current) return;
    setStatus(
      answered.ok
        ? { answer: answered.value, status: "answered" }
        : { error: answered.error, status: "refused" },
    );
  }, [cwd]);

  // The first page and the status, on mount. Both are reads of this worktree and
  // the pane is remounted per worktree, so this is the whole of the wiring.
  React.useEffect(() => {
    let live = true;
    setLog({ status: "reading" });
    void (async () => {
      const answered = await readHistory(cwd, null);
      if (!live) return;
      setLog(
        answered.ok
          ? {
              commits: answered.value.commits,
              more: answered.value.more,
              status: "answered",
            }
          : { error: answered.error, status: "refused" },
      );
    })();
    void readTheStatus();
    return () => {
      live = false;
    };
  }, [cwd, readTheStatus]);

  const sections =
    status.status === "answered" ? statusSections(status.answer) : [];
  const commits: Commit[] = log.status === "answered" ? log.commits : [];
  const rows = React.useMemo(
    () => historyRows(sections, commits),
    [sections, commits],
  );

  const openCommit = React.useCallback(
    async (commit: Commit) => {
      const mine = patchRead.current + 1;
      patchRead.current = mine;
      setPatch({ status: "reading" });
      const answered = await readCommitDiff(cwd, commit.hash);
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

  const openFile = React.useCallback(
    async (entry: StatusEntry) => {
      const mine = patchRead.current + 1;
      patchRead.current = mine;
      // Which status generation this read belongs to, so its answer cannot be
      // written into a cache a `Reread` has since emptied — see below.
      const under = statusRead.current;
      setPatch({ status: "reading" });
      // The HEAD diff, once. `gitWorktreeDiff` is the Diff pane's own read —
      // one patch source, not a second one grown for this pane.
      const read =
        headDiff.current ?? (await gitWorktreeDiff(cwd, STATUS_BASE));
      // Superseded, so neither the screen nor the cache: a row clicked after
      // this one owns the patch box now.
      if (patchRead.current !== mine || !alive.current) return;
      if (!read.ok) {
        // **Not cached.** Only an answer is worth keeping: a refusal written
        // into the cache is replayed for every later row he clicks, so one
        // transient failure — a lock file, a checkout gone for a moment — would
        // read as the pane being broken until he pressed Reread. The next click
        // asks git again.
        setPatch({
          note: explainWorktreeError(read.error).message,
          status: "refused",
        });
        return;
      }
      // Cached only if the status it was read alongside is still the one on
      // screen. `readTheStatus` empties this cache on purpose — by then it is a
      // reading of a tree that has moved — and a read in flight across that
      // moment would otherwise put the old tree straight back.
      if (statusRead.current === under) headDiff.current = read;
      const found = statusPatch(read.value, entry);
      setPatch(
        found === null
          ? { note: missingPatchNote(entry), status: "refused" }
          : { file: found, status: "file" },
      );
    },
    [cwd],
  );

  const open = React.useCallback(
    (row: HistoryRow) => {
      setSelected(row.key);
      if (row.kind === "commit") {
        void openCommit(row.commit);
        return;
      }
      void openFile(row.entry);
    },
    [openCommit, openFile],
  );

  const older = React.useCallback(async () => {
    if (log.status !== "answered" || !log.more || paging) return;
    const last = log.commits[log.commits.length - 1];
    if (last === undefined) return;
    setPaging(true);
    const answered = await readHistory(cwd, last.hash);
    // Serialised by `paging` and by the control's own `disabled`, so there is
    // no second page to be superseded by — only a pane that has gone.
    if (!alive.current) return;
    setPaging(false);
    if (!answered.ok) {
      // The list stays. See `pagingError`: replacing it with the refusal would
      // make one failed second page cost him the first.
      setPagingError(explainWorktreeError(answered.error).message);
      return;
    }
    setPagingError(null);
    setLog({
      commits: appendPage(log.commits, answered.value),
      more: answered.value.more,
      status: "answered",
    });
  }, [cwd, log, paging]);

  // **A window listener, exactly as the Diff pane binds the same three keys.**
  // `resolveDiffKey` was written for this shape — `inField` and `focusActivates`
  // are questions about `document.activeElement`, which only a window-level
  // handler is in a position to ask — and it is what lets `j`/`k` keep working
  // after the owner has clicked a row, since the rows are buttons and a handler
  // scoped to the pane's own box would be competing with them for the keystroke.
  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const focus = focusedElement();
      const action = resolveDiffKey({
        altKey: event.altKey,
        focusActivates: activatesOnEnter(focus),
        inField: isTypingTarget(focus),
        key: event.key,
        primaryModifier: event.metaKey || event.ctrlKey,
        repeat: event.repeat,
        shiftKey: event.shiftKey,
      });
      if (action === null || rows.length === 0) return;
      event.preventDefault();
      if (action.type === "step-file") {
        setSelected((at) => stepRow(rows, at, action.dir));
        return;
      }
      const row = rowFor(rows, selected);
      if (row !== null) open(row);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, rows, selected]);

  // **Take the keyboard when the pane arrives**, the same thing the Search pane
  // does with its field and for a sharper reason here: the pane on the left is a
  // terminal, and xterm keeps a hidden textarea focused whenever it is mounted.
  // `diffKeys.ts` refuses every letter typed into a field — correctly, since a
  // `j` in a terminal is a `j` — so without this the cursor keys would be eaten
  // by the terminal for as long as he had not clicked the pane, and `j` would
  // look like a key that does nothing. Measured: with the pane freshly opened
  // from ⌘K, `document.activeElement` is `textarea.xterm-helper-textarea`.
  React.useEffect(() => {
    paneRef.current?.focus();
  }, []);

  // And the cursor carries the focus with it, so that `Enter` opens the row
  // under the cursor rather than the row last clicked. Without this the two
  // drift apart the moment he clicks one row and then presses `j`: the
  // highlight moves, the focus does not, and `Enter` — which `diffKeys.ts`
  // deliberately surrenders to a focused control — activates the row he left.
  // It is also what scrolls a long list, which is the other half of `j` being
  // usable over two hundred commits.
  React.useEffect(() => {
    if (selected === null) return;
    const row = paneRef.current?.querySelector<HTMLElement>(
      `[data-row="${CSS.escape(selected)}"]`,
    );
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // The app's one diff-layout flag, read here exactly as the Diff pane reads
  // it — same store, same width precondition, same yielding list. Two panes,
  // one answer: a commit's patch and a worktree's are the same reading and must
  // not be laid out two different ways because they are drawn by two panes.
  const mode = effectiveDiffMode(useDiffMode(), splitFitsAt(paneWidth));
  const placement = diffListPlacement(
    paneWidth,
    mode === "split" ? SPLIT_MIN_PX : undefined,
  );
  const layout = historyLayout(placement, patch.status !== "none");
  const wraps = patchWrapsAt(paneWidth);

  return (
    // No key handler on the box: the keys are bound at the window, as the Diff
    // pane binds them. The box is focusable only so the pane can take the
    // keyboard off the terminal on mount; it is not a Tab stop, because the rows
    // themselves are buttons and they carry the tab order.
    <section
      className="flex h-full min-h-0 flex-col outline-none"
      data-testid="pane-history"
      ref={paneRef}
      tabIndex={-1}
    >
      <div className="flex min-h-0 flex-1">
        {layout === "patch" ? null : (
          <div
            className={
              layout === "both"
                ? "flex min-h-0 shrink-0 flex-col overflow-auto border-r border-border/60"
                : "flex min-h-0 flex-1 flex-col overflow-auto"
            }
            data-testid="history-list"
            style={
              layout === "both" && placement.where === "beside"
                ? { width: `${placement.listPx}px` }
                : undefined
            }
          >
            <SourceControl
              onOpen={open}
              selected={selected}
              state={status}
              onReread={() => void readTheStatus()}
            />
            <Commits
              onOlder={() => void older()}
              onOpen={open}
              paging={paging}
              pagingNote={pagingError}
              selected={selected}
              state={log}
            />
          </div>
        )}
        {layout === "list" ? null : (
          <Patch
            onBack={
              layout === "patch"
                ? () => {
                    setPatch({ status: "none" });
                  }
                : undefined
            }
            mode={mode}
            paneWidth={paneWidth}
            state={patch}
            wraps={wraps}
          />
        )}
      </div>
    </section>
  );
}
