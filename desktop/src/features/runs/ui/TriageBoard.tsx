// The landing surfaces' board: every worktree the workspace knows, strongest
// signal first (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md,
// Task 3).
//
// One component, two filters. `repoId: null` is the Deck, standing over the
// whole workspace; a project id is the panel inside that project. Everything
// it draws comes out of `lib/triage.ts` — the dot is Task 1's mark carried
// through, the order is that module's precedence, the sentence over the rows
// is `rollupMark`'s. Nothing is derived here.
//
// **Rows, not the card grid beside them.** The Deck's own idiom is a
// responsive grid of cards, and this surface keeps its count-badged eyebrow
// and its spacing but not its grid: a grid re-flows an ordered list into
// rows-then-columns, so which card is "first" becomes a fact about the window
// width. Ordering is this board's entire job, and one column of rows is the
// only layout in which the top of the list is the top of the list.
//
// **Everything is a door.** A row is a button that lands on that worktree in
// that project — both ids, because the board spans projects and the caller
// has to select both or the screen falls back to the project's own checkout.
//
// The type scale is `vingilot/docs/workbench.md`'s and is inherited, not
// re-decided: the eyebrow over the rows, Body for the sentence under it, Row
// for a branch name, Meta for the numbers and the age beside it.

import * as React from "react";

import type { TriageModel, TriageRow } from "@/features/runs/lib/triage";
import { ageLabel, triageBoard } from "@/features/runs/lib/triage";
import { AttentionDot } from "@/features/runs/ui/AttentionDot";

/** How often the ages on screen are re-read. A minute-grained label needs no
 * second hand, and this board is drawn over a workspace that is already
 * re-rendering on a 2s poll — the clock exists so an age still moves on a
 * surface nothing else is changing on. */
const AGE_TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(handle);
  }, []);
  return now;
}

export function TriageBoard({
  model,
  onOpen,
  repoId,
}: {
  model: TriageModel;
  onOpen: (repoId: string, worktreeId: string) => void;
  /** `null` for the whole workspace; a project id to narrow to one. */
  repoId: string | null;
}) {
  const view = triageBoard(model, repoId);
  const now = useNow();

  return (
    <section data-testid="triage-board">
      <h2 className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        WORKTREES
        <span className="text-muted-foreground/60">{view.rows.length}</span>
      </h2>
      <p
        className="mt-1 text-sm text-muted-foreground"
        data-testid="triage-headline"
      >
        {view.headline}
      </p>
      {view.rows.length === 0 ? null : (
        <ul className="mt-2 flex flex-col gap-0.5">
          {view.rows.map((row) => (
            <BoardRow
              key={row.worktreeId}
              now={now}
              onOpen={onOpen}
              row={row}
              showProject={repoId === null}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function BoardRow({
  now,
  onOpen,
  row,
  showProject,
}: {
  now: number;
  onOpen: (repoId: string, worktreeId: string) => void;
  row: TriageRow;
  /** The Deck spans projects and has to name which one a row is in; the
   * project's own panel would be printing its own name on every line. */
  showProject: boolean;
}) {
  const age = ageLabel(row.activityAt, now);
  return (
    <li>
      <button
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted/60"
        data-testid={`triage-row-${row.worktreeId}`}
        onClick={() => onOpen(row.repoId, row.worktreeId)}
        title={
          row.mark.sentence === ""
            ? `${row.projectName} — nothing has answered about this worktree yet`
            : `${row.projectName} — ${row.mark.sentence}`
        }
        type="button"
      >
        <AttentionDot mark={row.mark} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {row.label}
        </span>
        {showProject ? (
          <span className="max-w-[10rem] shrink-0 truncate text-2xs text-muted-foreground/70">
            {row.projectName}
          </span>
        ) : null}
        {row.detail === "" ? null : (
          <span
            className={`shrink-0 text-2xs ${
              row.mark.state === "dirty"
                ? "text-amber-600 dark:text-amber-500"
                : "text-muted-foreground/80"
            }`}
            data-testid={`triage-detail-${row.worktreeId}`}
          >
            {row.detail}
          </span>
        )}
        {age === "" ? null : (
          // The tooltip says which clock this is, because a date on a board is
          // believed: it is the coordinator's own `updated_at`, and a worktree
          // no run owns has none rather than borrowing the app's last look.
          <span
            className="w-16 shrink-0 text-right text-2xs text-muted-foreground/60"
            title={row.activityNote}
          >
            {age}
          </span>
        )}
      </button>
    </li>
  );
}
