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
//   git's numstat is a subprocess per worktree, so it is asked only about the
//   open project. A closed project's rows therefore arrive at `attentionMark`
//   with `stat: null`: they can say "needs you" and "working" but never "dirty"
//   or "quiet", and an absent answer becomes no dot rather than a quiet one.
//   Widening this is Task 3's decision to take, with its cost stated.

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
}

export function useWorktreeSignals(
  repos: readonly Repo[],
  grouped: GroupedWorktrees,
  selectedRepo: Repo | null,
  worktreeRoot: string | null,
): WorktreeSignals {
  const known =
    selectedRepo === null ? [] : (grouped.byRepo[selectedRepo.id] ?? []);
  const statTargets = React.useMemo<WorktreeTarget[]>(
    () =>
      selectedRepo === null || worktreeRoot === null
        ? []
        : known.flatMap((wt) => {
            const path = worktreeCwd(selectedRepo, wt, worktreeRoot);
            return path === null ? [] : [{ id: wt.binding_id, path }];
          }),
    [known, selectedRepo, worktreeRoot],
  );
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

  return { byRepo: dots.byRepo, byWorktree: dots.byWorktree, ordered, stats };
}
