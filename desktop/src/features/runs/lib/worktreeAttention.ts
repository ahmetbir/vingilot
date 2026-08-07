// What the worktree column puts first, and what it folds away
// (vingilot/docs/plans/2026-08-07-panes-and-polish.md, Task 3).
//
// **The column answers one question: what is happening right now?** The
// screenshot this task came from answered it with eleven rows, every one from
// a finished executor run, every one clean, all of them the same size as the
// one worktree the owner was actually working in. In a week it is fifty. So
// the rows are ordered by what deserves attention and the quiet ones fold
// behind a single row — folded, never deleted: nothing in this module or
// anywhere it is called removes a worktree, a branch, or a directory.
//
// **The ordering rule, in full.**
//
//   1. The project's own checkout, always first, whatever state it is in. It
//      is where the owner is when he has not chosen anything else, and a row
//      that moves because a file changed is a row he has to look for.
//   2. Dirty — uncommitted work. It is the only state that can be *lost*,
//      which is what makes it the first thing worth seeing.
//   3. Running — an owner run that has not reached a terminal status.
//      Something is happening; it needs watching, not saving.
//   4. Clean.
//
// Within a rank the incoming order is kept (a stable sort), so a worktree only
// ever moves because its state moved.
//
// **What folds.** A row that is clean, is not the project's checkout, and is
// not the one the owner is standing in. The selected worktree is exempt by
// construction rather than by a caller remembering to check — folding the row
// you are looking at is the one behaviour that would make this feature feel
// broken. Nothing folds while a filter query is on, because a search that
// hides matches is not a search.
//
// Pure: no Tauri, no React, no client. `WorktreeColumn` renders exactly what
// this returns.

import { isMainCheckout, type Worktree, worktreeSummary } from "./projects.ts";
import type { RunStatus } from "./runModel.ts";
import { type WorktreeStat, usableStat } from "./worktreeStat.ts";

/** Why a row sits where it does — and, for `dirty`, what the marker on it
 * means. `main` is not a rank of its own: the project's checkout is pinned
 * above everything and still shows whichever of the other three it is in. */
export type Attention = "dirty" | "running" | "clean";

/** Statuses a run does not come back from. Everything else — including
 * `paused` and `blocked`, which are waiting on the owner — is still running as
 * far as this column is concerned. */
const FINISHED: ReadonlySet<RunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const RANK: Record<Attention, number> = { clean: 2, dirty: 0, running: 1 };

/** Worktrees a project must have before the filter box appears. Below this the
 * list is short enough to read, and an input above it is one more thing on
 * screen that answers nothing. */
export const FILTER_THRESHOLD = 8;

/** Quiet worktrees there must be before folding them is worth doing. Folding
 * one row behind a row that says "1 clean worktree" costs a click and saves
 * nothing. */
export const FOLD_THRESHOLD = 3;

/** True when this worktree's run is over — the "dead run worktree" of the
 * plan. A row with no owner run at all is not one: the owner made it, or git
 * did, and nothing has finished. */
export function isFinishedRun(wt: Worktree): boolean {
  return wt.owner_run_status !== null && FINISHED.has(wt.owner_run_status);
}

/** Where a worktree sits.
 *
 * `stat` is what git says about the working tree right now; `null` means
 * nothing is known yet (the read has not answered, or could not). An unknown
 * tree is never called dirty — a marker that appears because a read is slow
 * would train the owner to ignore it. */
export function attentionOf(
  wt: Worktree,
  stat: WorktreeStat | null,
): Attention {
  // `stat?.dirty` and not `stat !== null && …`: a null stat is an absence of
  // knowledge, and it has to fall through to the run's own status rather than
  // short-circuiting to a state.
  if (stat?.dirty) return "dirty";
  if (wt.owner_run_status !== null && !FINISHED.has(wt.owner_run_status)) {
    return "running";
  }
  return "clean";
}

/** The worktrees in the order the column shows them, and the order the ⌘1…9
 * shortcuts therefore follow. Stable within a rank; the project's checkout is
 * pinned first regardless of its own state. */
export function orderWorktrees(
  worktrees: readonly Worktree[],
  stats: Readonly<Record<string, WorktreeStat>>,
): Worktree[] {
  return [...worktrees]
    .map((worktree, index) => ({ index, worktree }))
    .sort((a, b) => {
      const pinned =
        Number(isMainCheckout(b.worktree)) - Number(isMainCheckout(a.worktree));
      if (pinned !== 0) return pinned;
      const rank =
        RANK[
          attentionOf(a.worktree, usableStat(stats[a.worktree.binding_id]))
        ] -
        RANK[attentionOf(b.worktree, usableStat(stats[b.worktree.binding_id]))];
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.worktree);
}

/** One row, ready to render. `index` is the row's place in the ordered list —
 * the digit of its ⌘1…9 shortcut, which stays with the worktree whether the
 * fold is open or shut. */
export interface WorktreeRow {
  worktree: Worktree;
  attention: Attention;
  /** `null` when git has not answered for this worktree, or could not. The row
   * then says nothing about its contents rather than saying zero. */
  stat: WorktreeStat | null;
  index: number;
}

export interface WorktreeColumnView {
  /** What to draw, in order. */
  rows: WorktreeRow[];
  /** Rows the fold is hiding. Empty whenever the fold is open, a query is on,
   * or there were too few to be worth folding. */
  folded: WorktreeRow[];
  /** What the fold row says about what is behind it. Empty when nothing is. */
  foldLabel: string;
  /** True once the project has enough worktrees for a filter box to earn its
   * place. */
  showFilter: boolean;
  /** How many rows the query hid. Zero when there is no query. */
  filteredOut: number;
}

export interface WorktreeColumnInput {
  /** Already ordered — `orderWorktrees`' output, which is also what the ⌘1…9
   * map is built from. */
  worktrees: readonly Worktree[];
  stats: Readonly<Record<string, WorktreeStat>>;
  selectedId: string | null;
  /** The filter box's contents. Empty means no filter, which is also the only
   * state in which anything folds. */
  query: string;
  /** The owner has opened the fold. */
  expanded: boolean;
}

/** Case-insensitive substring match on what the row is labelled — the branch
 * name, or the stand-in for a checkout that has none. Matching the label and
 * not the binding id is the point: the id is hex, and nobody types hex. */
function matches(wt: Worktree, needle: string): boolean {
  return worktreeSummary(wt).label.toLowerCase().includes(needle);
}

/** What the fold row says. The noun is derived rather than assumed: these are
 * "finished runs" only when every one of them is one, and a fold that also
 * holds a worktree the owner made himself has no business calling it a run. */
export function foldLabelFor(folded: readonly WorktreeRow[]): string {
  if (folded.length === 0) return "";
  const plural = folded.length === 1 ? "" : "s";
  return folded.every((row) => isFinishedRun(row.worktree))
    ? `${folded.length} finished run${plural}`
    : `${folded.length} clean worktree${plural}`;
}

export function worktreeColumnView(
  input: WorktreeColumnInput,
): WorktreeColumnView {
  const all: WorktreeRow[] = input.worktrees.map((worktree, index) => {
    const stat = usableStat(input.stats[worktree.binding_id]);
    return { attention: attentionOf(worktree, stat), index, stat, worktree };
  });

  const showFilter = all.length > FILTER_THRESHOLD;
  const needle = input.query.trim().toLowerCase();
  if (needle !== "") {
    const rows = all.filter((row) => matches(row.worktree, needle));
    return {
      filteredOut: all.length - rows.length,
      foldLabel: "",
      folded: [],
      rows,
      showFilter,
    };
  }

  const foldable = (row: WorktreeRow) =>
    row.attention === "clean" &&
    !isMainCheckout(row.worktree) &&
    row.worktree.binding_id !== input.selectedId;

  // `foldLabel` is non-empty exactly when there is a fold, open or shut, and
  // `folded` is non-empty exactly when it is shut. The component needs both
  // facts and neither is derivable from the other.
  const quiet = all.filter(foldable);
  if (quiet.length < FOLD_THRESHOLD) {
    return {
      filteredOut: 0,
      foldLabel: "",
      folded: [],
      rows: all,
      showFilter,
    };
  }
  if (input.expanded) {
    return {
      filteredOut: 0,
      foldLabel: foldLabelFor(quiet),
      folded: [],
      rows: all,
      showFilter,
    };
  }

  return {
    filteredOut: 0,
    foldLabel: foldLabelFor(quiet),
    folded: quiet,
    rows: all.filter((row) => !foldable(row)),
    showFilter,
  };
}

/** The line under a row's label.
 *
 * **Only ever a statement git made.** With a stat, the numbers are git's own
 * (`+`/`−` for tracked lines, a file count for anything untracked or binary,
 * where lines are not the unit). Without one, the coordinator's stored diff
 * evidence is used if the run produced any, then the run's status — and if
 * neither exists the row says nothing at all, because "clean" is a claim and
 * this app has not read the tree yet. */
export function rowDetail(row: WorktreeRow): string {
  const { stat, worktree } = row;
  if (stat === null) {
    if (worktree.added !== null && worktree.removed !== null) {
      return `+${worktree.added} −${worktree.removed}`;
    }
    return worktree.owner_run_status ?? "";
  }
  if (!stat.dirty) return "clean";

  const parts: string[] = [];
  if (stat.additions > 0 || stat.deletions > 0) {
    parts.push(`+${stat.additions} −${stat.deletions}`);
  } else if (stat.changedFiles > 0) {
    // A binary or mode-only change: real work, and zero lines on both sides.
    parts.push(`${stat.changedFiles} changed`);
  }
  if (stat.untracked > 0) parts.push(`${stat.untracked} new`);
  return parts.join(" · ");
}

/** The worktrees git itself reports as prunable — their directories are gone,
 * so what is left is bookkeeping in `.git/worktrees/`. `lifecycle` is where
 * `localWorktreeRow` puts git's own flag; a coordinator-owned row never
 * carries it, because the coordinator has no opinion about a directory. */
export function prunableWorktrees(worktrees: readonly Worktree[]): Worktree[] {
  return worktrees.filter((wt) => wt.lifecycle === "prunable");
}
