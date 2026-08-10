// Every live signal the Projects screen reads about a worktree, gathered once
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// The screen used to gather these inline, and Task 1 would have added a third
// step to that run: pick the stat targets, poll git, derive the dots, order the
// rows. They are one subject — what is true of a worktree right now — and this
// module is where that subject lives, so the surfaces below it render an answer
// rather than compute one.
//
// **One derivation, two surfaces.** The worktree column draws a dot per row and
// the project nav draws the rollup beside the project; both read `attention`
// from here, and neither derives anything itself. A second derivation is how
// two dots come to disagree about the same worktree, and the whole argument for
// a dot is that it can be believed without being checked.
//
// **What each signal costs, and therefore how wide it reaches.**
//
//   The coordinator's rows carry `owner_run_status` for every worktree in the
//   workspace on one 2s poll (`usePolling.ts`), so the rollup on a project the
//   owner is not standing in is as current as the one he is.
//
//   git's numstat used to be asked only about the open project, on the grounds
//   that it is a subprocess per worktree. Task 3 widens it to every project,
//   deliberately, and this is the price: `stat()` runs **four short git reads
//   per worktree** (`rev-parse --git-dir`, `rev-parse --verify HEAD`, `diff
//   --numstat -z HEAD`, `ls-files --others`, in
//   `vingilot_worktree/stat.rs`), sequentially, on one blocking thread, once
//   every 5s. Twelve worktrees is 48 short reads a tick; the reads are
//   `--numstat` and `ls-files`, never `WorktreeDiff`'s per-file patches, which
//   is the cost that made narrowing necessary in the first place.
//
//   **The cap is the backend's, and it is why the open project goes first.**
//   `stat.rs`'s `MAX_PATHS` answers 64 paths and no more; past it the tail
//   comes back unasked, which reaches `attentionMark` as `stat: null` and
//   draws no dot — the honest rendering of a number this app declined to
//   spend. Beyond 64 worktrees the *tail* is what loses its numbers, so the
//   open project is put at the head of the batch: the surface the owner is
//   standing on is the last thing that may go quiet.
//
//   A closed project's rows can therefore now say "dirty" and "quiet", which
//   is what makes the dashboard a board rather than a list of the one project
//   already on screen.

import * as React from "react";

import {
  type AttentionMark,
  attentionMark,
  rollupMark,
} from "@/features/runs/lib/attentionSignal";
import type {
  GroupedWorktrees,
  Repo,
  Worktree,
} from "@/features/runs/lib/projects";
import { worktreeCwd } from "@/features/runs/lib/projects";
import type { RunSummary } from "@/features/runs/lib/runModel";
import type { TriageModel } from "@/features/runs/lib/triage";
import { triageModel } from "@/features/runs/lib/triage";
import { useAskPending } from "@/features/runs/lib/useAskPending";
import {
  useWorktreeStats,
  type WorktreeStats,
  type WorktreeTarget,
} from "@/features/runs/lib/useWorktreeStats";
import { orderWorktrees } from "@/features/runs/lib/worktreeAttention";
import { usableStat } from "@/features/runs/lib/worktreeStat";

export interface WorktreeSignals {
  /** git's read of the open project's worktrees, by binding id. A worktree with
   * no entry is one nothing is known about — never one that is clean. */
  stats: WorktreeStats;
  /** The open project's worktrees in the order the column shows them, which is
   * also the order the ⌘1…9 shortcuts follow. */
  ordered: Worktree[];
  /** The dot for each worktree, by binding id. */
  byWorktree: ReadonlyMap<string, AttentionMark>;
  /** The dot for each project — the strongest state among its worktrees. Every
   * repo in `repos` gets an entry, possibly a no-dot one. */
  byRepo: Readonly<Record<string, AttentionMark>>;
  /** Every project's worktrees as one ordered board, for the two landing
   * surfaces (`lib/triage.ts`). Built here rather than in a screen because it
   * is the same derivation the two dots above are: a third surface computing
   * its own would be a third opinion about one worktree. */
  triage: TriageModel;
}

export function useWorktreeSignals(
  repos: readonly Repo[],
  grouped: GroupedWorktrees,
  selectedRepo: Repo | null,
  worktreeRoot: string | null,
  runs: readonly RunSummary[],
): WorktreeSignals {
  const known =
    selectedRepo === null ? [] : (grouped.byRepo[selectedRepo.id] ?? []);
  // Every project, with the open one at the head — see this module's header
  // for what each entry costs and what the backend's cap does to the tail.
  const statTargets = React.useMemo<WorktreeTarget[]>(() => {
    if (worktreeRoot === null) return [];
    const ordered =
      selectedRepo === null
        ? repos
        : [
            selectedRepo,
            ...repos.filter((repo) => repo.id !== selectedRepo.id),
          ];
    return ordered.flatMap((repo) =>
      (grouped.byRepo[repo.id] ?? []).flatMap((wt) => {
        const path = worktreeCwd(repo, wt, worktreeRoot);
        return path === null ? [] : [{ id: wt.binding_id, path }];
      }),
    );
  }, [grouped, repos, selectedRepo, worktreeRoot]);
  const stats = useWorktreeStats(statTargets);

  const pending = useAskPending();
  // Only the directory matters here; the exchange id changes with every
  // question and would rebuild every mark on the screen for a fact no dot reads.
  const askCwd = pending?.cwd ?? null;

  const dots = React.useMemo(() => {
    const byWorktree = new Map<string, AttentionMark>();
    const byRepo: Record<string, AttentionMark> = {};
    for (const repo of repos) {
      const marks: AttentionMark[] = [];
      for (const worktree of grouped.byRepo[repo.id] ?? []) {
        // Before the shell has answered with a worktree root there is no path
        // to compare the in-flight turn against. The other two signals still
        // stand, so the row is derived without that one rather than skipped.
        const cwd =
          worktreeRoot === null
            ? null
            : worktreeCwd(repo, worktree, worktreeRoot);
        const mark = attentionMark({
          askInFlight: cwd !== null && cwd === askCwd,
          runStatus: worktree.owner_run_status,
          stat: usableStat(stats[worktree.binding_id]),
        });
        byWorktree.set(worktree.binding_id, mark);
        marks.push(mark);
      }
      byRepo[repo.id] = rollupMark(marks);
    }
    return { byRepo, byWorktree };
  }, [repos, grouped, stats, worktreeRoot, askCwd]);

  // One ordering, shared: the column renders it and the ⌘1…9 map is built from
  // it, so the digit beside a row is the digit that selects it.
  const ordered = React.useMemo(
    () => orderWorktrees(known, stats),
    [known, stats],
  );

  const triage = React.useMemo(
    () => triageModel({ grouped, marks: dots.byWorktree, repos, runs, stats }),
    [dots.byWorktree, grouped, repos, runs, stats],
  );

  return {
    byRepo: dots.byRepo,
    byWorktree: dots.byWorktree,
    ordered,
    stats,
    triage,
  };
}
