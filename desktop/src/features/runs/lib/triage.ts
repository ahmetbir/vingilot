// The landing surfaces' triage board: every project's worktrees on one
// surface, strongest signal first
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 3).
//
// **Nothing is derived here that Task 1 already derives.** The dot on a row is
// the mark `attentionSignal.ts` produced for that worktree, carried through
// untouched, and the order is that module's own `outranks` asked directly
// rather than a list of the four states retyped in this file — a second copy of
// a precedence is how two surfaces come to disagree about the same worktree.
// The `+`/`−` is `worktreeAttention.ts`'s `rowDetail`, the same sentence the
// worktree column puts under a row.
//
// **Ordering, and why an unanswered row sinks rather than rises.** needs-you,
// working, dirty, quiet — then the rows nothing has answered about, last.
// A row with no dot is one git has not reported on; it is not a claim of
// urgency and must not be ranked as one, and the deciding argument is
// movement: stat answers land asynchronously, so an unknown row ranked above
// quiet would leap to the top of the board and drop back seconds later, moving
// under him for a reason nothing on screen explains. Within a rank the incoming
// order is kept (a stable sort), so a row only ever moves because its state
// moved.
//
// **The date on a row is the coordinator's, or there is none.** The plan
// offered "newest of coordinator revision or stat observation"; the second is
// dropped, and visibly. `useWorktreeStats` re-reads every worktree on one 5s
// timer, so an observation time is a fact about when this app last *looked* and
// would print the same "3s ago" on every row on the board — a column carrying
// no information, spending the owner's trust to say nothing. What is left is a
// real per-row date the coordinator publishes: `updated_at` on the run that
// owns the worktree. A worktree no run owns — the project's own checkout, one
// made in a shell — carries no date at all, and the cell says so rather than
// borrowing one.
//
// Pure: no React, no Tauri, no client. `useWorktreeSignals.ts` gathers the
// signals, `ui/TriageBoard.tsx` renders exactly what comes out of here.

import {
  type AttentionMark,
  endedNote,
  NO_MARK,
  outranks,
  rollupMark,
} from "./attentionSignal.ts";
import type { GroupedWorktrees, Repo } from "./projects.ts";
import { worktreeSummary } from "./projects.ts";
import type { RunSummary } from "./runModel.ts";
import { attentionOf, rowDetail } from "./worktreeAttention.ts";
import type { WorktreeStat } from "./worktreeStat.ts";
import { usableStat } from "./worktreeStat.ts";

/** One worktree, as the board draws it. Everything a row needs and nothing a
 * row does not: a field with no reader agrees with nothing and drifts
 * unnoticed. */
export interface TriageRow {
  worktreeId: string;
  /** Which project to open along with the worktree — the board spans projects,
   * so a click has to name both. */
  repoId: string;
  projectName: string;
  /** The branch, or the stand-in a checkout with none gets — the same label
   * every other surface in this feature calls it by (`worktreeSummary`). */
  label: string;
  /** Task 1's mark for this worktree, carried, never re-derived. */
  mark: AttentionMark;
  /** The line under a row's label, from `rowDetail` — the same sentence the
   * worktree column puts under the same worktree, so the two surfaces cannot
   * report different numbers for one tree.
   *
   * With a stat it is git's own count, the cheap numstat on the 5s poll, never
   * `WorktreeDiff`'s per-file patches — that is the whole reason this board
   * could be widened to every project. Without one it is whatever the
   * coordinator's own row already carries (its stored `added`/`removed`, then
   * the run's status), which costs nothing to read and is still something
   * somebody said. Empty only when neither has said anything, which is a
   * different thing from `clean`. */
  detail: string;
  /** ISO timestamp, or `null` when no run owns this worktree and therefore
   * nothing here carries a date. */
  activityAt: string | null;
  /** What that date is, in words, for the cell's tooltip. Empty with no date. */
  activityNote: string;
}

/** Every row the board can show, with the number of projects they were built
 * from. The count is carried rather than inferred from the rows: "no rows"
 * and "no projects" are different answers and get different sentences. */
export interface TriageModel {
  rows: readonly TriageRow[];
  projects: number;
}

export interface TriageInput {
  repos: readonly Repo[];
  grouped: GroupedWorktrees;
  /** Task 1's dots, by binding id — `useWorktreeSignals`' `byWorktree`. */
  marks: ReadonlyMap<string, AttentionMark>;
  stats: Readonly<Record<string, WorktreeStat>>;
  /** The workspace's runs, for the one date a row can honestly carry. */
  runs: readonly RunSummary[];
}

/** Rows for every project, ordered attention-first. */
export function triageModel(input: TriageInput): TriageModel {
  const byRun = new Map(input.runs.map((run) => [run.id, run]));
  const rows: TriageRow[] = [];

  for (const repo of input.repos) {
    for (const worktree of input.grouped.byRepo[repo.id] ?? []) {
      const stat = usableStat(input.stats[worktree.binding_id]);
      const run =
        worktree.owner_run_id === null
          ? undefined
          : byRun.get(worktree.owner_run_id);
      rows.push({
        activityAt: run?.updated_at ?? null,
        activityNote:
          run === undefined
            ? ""
            : "the coordinator's own updated_at for the run that owns this worktree",
        detail: rowDetail({
          attention: attentionOf(worktree, stat),
          index: rows.length,
          stat,
          worktree,
        }),
        label: worktreeSummary(worktree).label,
        mark: input.marks.get(worktree.binding_id) ?? NO_MARK,
        projectName: repo.name,
        repoId: repo.id,
        worktreeId: worktree.binding_id,
      });
    }
  }

  rows.sort((a, b) => byAttention(a.mark, b.mark));
  return { projects: input.repos.length, rows };
}

/** The precedence, asked of `attentionSignal.ts` rather than restated. A mark
 * with no state sorts last against everything including another one — equal to
 * its own kind, so the incoming order survives among them too. */
function byAttention(a: AttentionMark, b: AttentionMark): number {
  if (a.state === null) return b.state === null ? 0 : 1;
  if (b.state === null) return -1;
  if (a.state === b.state) return 0;
  return outranks(a.state, b.state) ? -1 : 1;
}

/** How long ago a row's date was, in the words a board has room for. Empty
 * for a row with no date, which is the same emptiness `activityAt: null`
 * already is — a row that cannot be dated says nothing rather than "never".
 *
 * A date the clock has not reached yet reads as `just now` rather than as a
 * negative age: the coordinator stamps `updated_at` on its own machine, and a
 * few seconds of skew between two clocks is not a fact about the run. */
export function ageLabel(activityAt: string | null, nowMs: number): string {
  if (activityAt === null) return "";
  const at = Date.parse(activityAt);
  if (Number.isNaN(at)) return "";
  const seconds = Math.floor((nowMs - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** What the board draws, once a surface has said which project it is about. */
export interface TriageBoardView {
  rows: readonly TriageRow[];
  /** The one sentence above the rows. Never empty: an empty board with nothing
   * said over it is the emptiness this dashboard exists to end. */
  headline: string;
}

/**
 * The rows for one surface and the sentence over them.
 *
 * `repoId` is the only difference between the two landing surfaces: `null` is
 * the Deck, which stands over the whole workspace, and a project id is the
 * panel inside that project. One component, two filters.
 *
 * **Every answer is its own sentence, and each is honest about its scope.**
 * The loud headlines and the quiet one come from `rollupMark`, which is the
 * same function the project dots in the nav are rolled up by — including its
 * rule that one worktree nothing has answered about costs the set its "nothing
 * needs you", because that claim is about all of them. So the board cannot say
 * everything is clean over a row git was never asked about; the last two
 * sentences below are what it says instead, and they are two because
 * `rollupMark` withholds a state for two different reasons.
 *
 * The same guard applies to a run that stopped without finishing: whichever of
 * these sentences is reached, none of them may sum a `failed` or `cancelled`
 * run away into "nothing is waiting on you". The words are `endedNote`'s, so
 * the headline over the board and the dot in the nav name that ending
 * identically.
 *
 * The no-worktrees sentence is reachable through this function and not through
 * the screen today: `groupWorktrees` seeds every project with its own checkout,
 * so a project always has at least one row. It is here because this function
 * renders what it was given rather than what it assumes, and a board that drew
 * nothing with nothing said over it would be the one failure this whole surface
 * exists to prevent.
 */
export function triageBoard(
  model: TriageModel,
  repoId: string | null,
): TriageBoardView {
  const rows =
    repoId === null
      ? model.rows
      : model.rows.filter((row) => row.repoId === repoId);

  if (rows.length === 0) {
    if (model.projects === 0) {
      return {
        headline: "No projects yet — add one and its worktrees appear here.",
        rows,
      };
    }
    return { headline: "This project has no worktrees yet.", rows };
  }

  const rollup = rollupMark(rows.map((row) => row.mark));
  if (rollup.state !== null) return { headline: rollup.sentence, rows };

  // `rollupMark` withholds a state for two different reasons and the board owes
  // a different sentence to each. Every row silent is "this app has been told
  // nothing"; some quiet and some silent is the answer it *does* have, said
  // without letting the quiet ones speak for the rows git never reported on.
  const silent = rows.filter((row) => row.mark.state === null).length;
  if (silent === rows.length) {
    return {
      headline:
        "Nothing has answered yet — no run is pressing, and git has not reported on these worktrees.",
      rows,
    };
  }
  const answered = rows.length - silent;
  const clean = `${answered} worktree${answered === 1 ? " is" : "s are"} clean`;
  // The same ending `rollupMark`'s quiet sentence names, in the same words
  // (`endedNote`), because this branch is reached *instead* of that one and
  // makes the same claim: a run that stopped without finishing must not be
  // summed away by a sentence that says nothing is waiting.
  const ended = endedNote(rows.map((row) => row.mark));
  return {
    headline:
      ended === ""
        ? `Nothing is waiting on you — git says ${clean}, and has not reported on ${silent}.`
        : `Git says ${clean} and has not reported on ${silent}${ended}.`,
    rows,
  };
}
