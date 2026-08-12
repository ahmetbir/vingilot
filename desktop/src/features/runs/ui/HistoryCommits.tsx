// The History pane's commit list
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//
// Split out of `HistoryPane.tsx` when that file reached the 1000-line ratchet:
// the pane file keeps the effects and the layout, this one draws the list.
// What a page is, what "older" says and how a row is keyed are all
// `lib/historyModel.ts`'s decisions, exactly as before the split.

import type { Commit, HistoryRow } from "@/features/runs/lib/historyModel";
import {
  commitDate,
  commitSubject,
  logReading,
  type LogState,
} from "@/features/runs/lib/historyModel";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { PaneSection } from "@/features/runs/ui/PaneSection";

export function Commits({
  onOlder,
  onOpen,
  paging,
  pagingNote,
  selected,
  state,
}: {
  onOlder: () => void;
  onOpen: (row: HistoryRow) => void;
  paging: boolean;
  /** A refused *page*, beside the control that asked for it — never in place of
   * the list. See `pagingError` in `HistoryBody`. */
  pagingNote: string | null;
  selected: string | null;
  state: LogState;
}) {
  const reading = logReading(
    state,
    state.status === "refused" ? explainWorktreeError(state.error).message : "",
  );
  const commits = state.status === "answered" ? state.commits : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <PaneSection title="History" />
      </div>
      {reading.show === "rows" ? (
        <div
          aria-label="commit history"
          className="min-h-0 flex-1 overflow-auto"
          data-testid="history-commits"
          role="listbox"
          tabIndex={-1}
        >
          {commits.map((commit) => {
            const key = `commit:${commit.hash}`;
            return (
              <CommitRow
                commit={commit}
                isSelected={key === selected}
                key={key}
                onOpen={() => onOpen({ commit, key, kind: "commit" })}
                rowKey={key}
              />
            );
          })}
          {reading.note === null ? null : (
            <div className="flex flex-col gap-0.5 px-2 py-1">
              <div className="flex items-baseline gap-2">
                <span
                  className="min-w-0 flex-1 text-2xs text-muted-foreground"
                  data-testid="history-older-note"
                >
                  {reading.note}
                </span>
                {/* A read, and the only other control in the pane: it asks git
                    for the page under the one on screen. */}
                <button
                  className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                  data-testid="history-older"
                  disabled={paging}
                  onClick={onOlder}
                  type="button"
                >
                  {paging ? "Reading…" : "Older"}
                </button>
              </div>
              {/* Beside the control, under the list that is still there. The
                  page failed; the history did not. */}
              {pagingNote === null ? null : (
                <p
                  className="text-2xs text-destructive"
                  data-testid="history-older-refused"
                >
                  could not read the page under this one — {pagingNote}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p
          className="px-2 py-1 text-2xs text-muted-foreground"
          data-testid={`history-log-${reading.show}`}
        >
          {reading.note}
        </p>
      )}
    </div>
  );
}

function CommitRow({
  commit,
  isSelected,
  onOpen,
  rowKey,
}: {
  commit: Commit;
  isSelected: boolean;
  onOpen: () => void;
  rowKey: string;
}) {
  return (
    <button
      aria-selected={isSelected}
      className={`flex w-full flex-col gap-0.5 px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
        isSelected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60"
      }`}
      data-row={rowKey}
      data-testid={`history-commit-${commit.hash}`}
      onClick={onOpen}
      role="option"
      type="button"
    >
      <span className="flex w-full items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {commitSubject(commit)}
        </span>
        {commit.refs.map((ref) => (
          <span
            className="shrink-0 rounded border border-border/60 px-1 text-2xs text-muted-foreground"
            data-testid={`history-ref-${ref}`}
            key={ref}
          >
            {ref}
          </span>
        ))}
      </span>
      <span className="flex w-full items-baseline gap-2 text-2xs text-muted-foreground">
        <span className="shrink-0 font-mono">{commit.short}</span>
        <span className="min-w-0 flex-1 truncate">{commit.author}</span>
        <span className="shrink-0 tabular-nums">{commitDate(commit.date)}</span>
      </span>
    </button>
  );
}
