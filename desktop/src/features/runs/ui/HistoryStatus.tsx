// The History pane's source-control half: git's four status columns as rows
// (vingilot/docs/plans/2026-08-11-what-sent-him-to-vscode.md, Task 4).
//
// Split out of `HistoryPane.tsx` when that file reached the 1000-line ratchet:
// the pane file keeps the effects and the layout, this one draws the status
// section. What an answer means, which sections exist and what each sentence
// says are all `lib/historyModel.ts`'s decisions, exactly as before the split.
//
// Nothing here writes. The only control is Reread, which asks git the same
// question again — `workspace-history.spec.ts` reads every control in the pane
// and fails on any whose name is a mutating verb.

import type { HistoryRow, StatusEntry } from "@/features/runs/lib/historyModel";
import {
  statusHeadline,
  statusReading,
  statusSections,
  type StatusState,
} from "@/features/runs/lib/historyModel";
import {
  changeMark,
  changeMarkClass,
  labelParts,
} from "@/features/runs/lib/worktreeDiff";
import { explainWorktreeError } from "@/features/runs/lib/worktreePlan";
import { PaneSection } from "@/features/runs/ui/PaneSection";

export function SourceControl({
  onOpen,
  onReread,
  selected,
  state,
}: {
  onOpen: (row: HistoryRow) => void;
  onReread: () => void;
  selected: string | null;
  state: StatusState;
}) {
  const reading = statusReading(
    state,
    state.status === "refused" ? explainWorktreeError(state.error).message : "",
  );
  const sections =
    state.status === "answered" ? statusSections(state.answer) : [];

  return (
    <div className="shrink-0 border-b border-border/60">
      <PaneSection
        control={
          // The only control in this section, and it is a READ: it asks git
          // the same question again. Named "Reread" rather than "Refresh"
          // because refresh is what a page does and this is what git is asked.
          <button
            className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            data-testid="history-status-reread"
            onClick={onReread}
            type="button"
          >
            Reread
          </button>
        }
        meta={
          state.status === "answered" ? (
            <span
              className="min-w-0 flex-1 truncate text-2xs text-muted-foreground"
              data-testid="history-status-headline"
            >
              {statusHeadline(state.answer)}
            </span>
          ) : undefined
        }
        title="Source control"
      />

      {reading.show === "rows" ? (
        <>
          {reading.note === null ? null : (
            <p
              className="px-2 pb-1 text-2xs text-foreground"
              data-testid="history-status-omitted"
            >
              {reading.note}
            </p>
          )}
          {sections.map((section) => (
            <div key={section.id}>
              <p
                className="px-2 py-0.5 text-2xs text-muted-foreground"
                data-testid={`history-section-${section.id}`}
              >
                <span className="font-semibold text-foreground">
                  {section.title}
                </span>{" "}
                <span className="tabular-nums">{section.entries.length}</span> ·{" "}
                {section.note}
              </p>
              {section.entries.map((entry) => {
                const key = `status:${section.id}:${entry.path}`;
                return (
                  <FileRow
                    entry={entry}
                    isSelected={key === selected}
                    key={key}
                    onOpen={() =>
                      onOpen({
                        entry,
                        key,
                        kind: "status",
                        section: section.id,
                      })
                    }
                    rowKey={key}
                  />
                );
              })}
            </div>
          ))}
        </>
      ) : (
        // One element for the other three readings, with the testid saying
        // which — `empty` ("the working tree is clean") is only ever reachable
        // from an answer, which is `statusReading`'s job.
        <p
          className="px-2 pb-1 text-2xs text-muted-foreground"
          data-testid={`history-status-${reading.show}`}
        >
          {reading.note}
        </p>
      )}
    </div>
  );
}

function FileRow({
  entry,
  isSelected,
  onOpen,
  rowKey,
}: {
  entry: StatusEntry;
  isSelected: boolean;
  onOpen: () => void;
  rowKey: string;
}) {
  // The label's tail is the half that identifies the file, so the two parts go
  // to the layout separately and only the lead gives way — the same rule
  // `WorktreeDiffPanel`'s `PathLabel` keeps, for the reason `labelParts`
  // documents. The lead dims as a token (`text-muted-foreground`) rather than
  // an opacity, so every path in the app dims the same way.
  const label =
    entry.oldPath === null ? entry.path : `${entry.oldPath} → ${entry.path}`;
  const parts = labelParts(label);
  return (
    <button
      aria-selected={isSelected}
      className={`flex w-full items-baseline gap-2 px-2 py-0.5 text-left text-2xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${
        isSelected
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60"
      }`}
      data-row={rowKey}
      data-testid={`history-file-${rowKey}`}
      onClick={onOpen}
      role="option"
      type="button"
    >
      <span
        className={`w-3 shrink-0 font-mono ${changeMarkClass(entry.change)}`}
        title={`git status ${entry.code}`}
      >
        {changeMark(entry.change)}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline" title={label}>
        <span className="min-w-0 shrink truncate text-muted-foreground">
          {parts.lead}
        </span>
        <span className="shrink-0 text-foreground">{parts.name}</span>
      </span>
    </button>
  );
}
