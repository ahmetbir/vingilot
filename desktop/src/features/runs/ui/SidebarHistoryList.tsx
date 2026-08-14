// The status + commit lists, hosted by the Deck sidebar's History accordion
// member (vingilot/docs/plans/2026-08-14-pane-nav-absorb.md, Task 5).
//
// **This is `HistoryPane.tsx`'s list half, moved — the shared patch box did
// not move and did not fork.** Source control above history, both rendered by
// the same `SourceControl`/`Commits` components as before, both feeding the
// one `PatchView` that stays in the pane ("do not fork the patch component" —
// unchanged rule, new geometry). The two sections move together as ONE
// accordion member, not two: splitting them was already forbidden by name.
// Selecting a row files a target (`lib/historyTarget.ts`) and asks the
// workspace to bring the History pane forward — the same two moves
// `show-file` makes for the Files viewer.
//
// **The keyboard has exactly one owner, and it is this list** (plan §3.3, and
// the self-review's "most likely to be got wrong quietly"). The pane's old
// `j`/`k` binding was a *window* listener; hosted here it is scoped to this
// element's own `onKeyDown`, so it hears a keystroke only while focus is
// inside the list — and the pane's window listener is DELETED, not
// duplicated: with the rows gone there is nothing left in the pane for `j` to
// walk. One press, one cursor, one listener; the e2e spec presses `j` once
// and counts what moved.
//
// **Reads stay honest across the split.** `readTheStatus` stamps a
// generation, every status pick carries it, and the pane's HEAD-diff cache is
// keyed by it — the "a Reread retires the cache" invariant that used to be a
// single ref inside one component (see `historyTarget.ts`'s header). Paging,
// the refused-page banner and the superseded-status guard are the pane's old
// code, unchanged.

import * as React from "react";

import {
  activatesOnEnter,
  type FocusedElement,
  isTypingTarget,
  resolveDiffKey,
} from "@/features/runs/lib/diffKeys";
import { readHistory, readStatus } from "@/features/runs/lib/historyClient";
import {
  appendPage,
  type Commit,
  type HistoryRow,
  historyRows,
  type LogState,
  rowFor,
  statusSections,
  type StatusState,
  stepRow,
} from "@/features/runs/lib/historyModel";
import { requestHistoryPatch } from "@/features/runs/lib/historyTarget";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { Commits } from "@/features/runs/ui/HistoryCommits";
import { SourceControl } from "@/features/runs/ui/HistoryStatus";

/** As much of the event's target as `diffKeys.ts` needs — the same three
 * lines `HistoryPane` kept, read off the event now that the handler is scoped
 * to this element instead of the window. */
function focusedFrom(target: EventTarget | null): FocusedElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return {
    contentEditable: target.isContentEditable,
    role: target.getAttribute("role"),
    tagName: target.tagName,
  };
}

export function SidebarHistoryList({
  active,
  cwd,
  showHistory,
}: {
  /** Whether this accordion member is the open one — the cue to take the
   * keyboard, so `j` works the moment the owner opens History without a
   * click first (the pane used to do this on mount, off the terminal's
   * hidden textarea). */
  active: boolean;
  cwd: string;
  /** Bring the History pane forward — `RunsScreen`'s own `showPane`, the same
   * gesture `show-file` ends in. */
  showHistory: () => void;
}) {
  const [log, setLog] = React.useState<LogState>({ status: "idle" });
  const [status, setStatus] = React.useState<StatusState>({ status: "idle" });
  const [selected, setSelected] = React.useState<string | null>(null);
  const [paging, setPaging] = React.useState(false);
  // A refused *page*, held apart from `log` — `HistoryPane`'s old rule,
  // unchanged: a second page git said no to costs the page, not the commits
  // already on screen.
  const [pagingError, setPagingError] = React.useState<string | null>(null);

  const listRef = React.useRef<HTMLDivElement | null>(null);

  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Which status read is the current one — and the generation every status
   * pick is stamped with, so the pane's HEAD-diff cache retires with it. */
  const statusRead = React.useRef(0);

  const readTheStatus = React.useCallback(async () => {
    const mine = statusRead.current + 1;
    statusRead.current = mine;
    setStatus({ status: "reading" });
    const answered = await readStatus(cwd);
    if (statusRead.current !== mine || !alive.current) return;
    setStatus(
      answered.ok
        ? { answer: answered.value, status: "answered" }
        : { error: answered.error, status: "refused" },
    );
  }, [cwd]);

  // The first page and the status, on mount. The host keys this component by
  // `cwd`, so this is the whole of the wiring.
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

  const open = React.useCallback(
    (row: HistoryRow) => {
      setSelected(row.key);
      // File the target first, then bring the pane forward — `show-file`'s
      // order, which is what makes a pick land in a pane not yet mounted.
      requestHistoryPatch({
        pick:
          row.kind === "commit"
            ? { commit: row.commit, kind: "commit" }
            : {
                entry: row.entry,
                kind: "status",
                statusGeneration: statusRead.current,
              },
        worktree: cwd,
      });
      showHistory();
    },
    [cwd, showHistory],
  );

  const older = React.useCallback(async () => {
    if (log.status !== "answered" || !log.more || paging) return;
    const last = log.commits[log.commits.length - 1];
    if (last === undefined) return;
    setPaging(true);
    const answered = await readHistory(cwd, last.hash);
    if (!alive.current) return;
    setPaging(false);
    if (!answered.ok) {
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

  // **Scoped, not a window listener — the one adjustment §3.3 demanded.**
  // `resolveDiffKey`'s two focus questions are answered from the event's own
  // target, which inside a scoped handler is the same element
  // `document.activeElement` would name.
  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const focus = focusedFrom(event.target);
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
    },
    [open, rows, selected],
  );

  // Take the keyboard when the member opens: without this, `j` after opening
  // History would still be typing into the terminal's hidden textarea — the
  // same measurement the pane's old focus-on-mount was made for.
  React.useEffect(() => {
    if (active) listRef.current?.focus();
  }, [active]);

  // The cursor carries the focus with it, so `Enter` opens the row under the
  // cursor rather than the row last clicked — `HistoryPane`'s old effect,
  // scoped to this list.
  React.useEffect(() => {
    if (selected === null) return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-row="${CSS.escape(selected)}"]`,
    );
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the rows are the real interactive elements and carry the tab order; this box only takes the keyboard off the terminal and routes j/k/Enter to them — the pane's old `<section tabIndex={-1}>` arrangement, scoped.
    <div
      className="flex w-full flex-col outline-none"
      data-testid="history-list"
      onKeyDown={onKeyDown}
      ref={listRef}
      tabIndex={-1}
    >
      <SourceControl
        cwd={cwd}
        onOpen={open}
        onReread={() => void readTheStatus()}
        selected={selected}
        state={status}
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
  );
}
