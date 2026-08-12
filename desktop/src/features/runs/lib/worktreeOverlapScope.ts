// Where the overlap comparison's boundary is drawn, and what it is allowed to
// read (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// `worktreeOverlap.ts` answers "which of THESE worktrees share a file". This
// module answers the two questions its caller has to get right before asking:
// **which worktrees go in one comparison**, and **which of them have actually
// answered**. Both are rules the pure model cannot enforce, because both are
// facts about the workspace it is never handed.
//
// **One repository per comparison — the rule this module exists to hold.**
// Two projects with a `README.md` each are not in conflict. Compare across
// them and nearly every row in a multi-project workspace grows a mark, which
// is the surface-destroying false positive this island's whole dot discipline
// is built to avoid: a mark on everything is a mark the owner stops reading,
// and it takes the honest marks down with it. So the loop below is per repo
// and the results are merged only afterwards — merged safely because binding
// ids are unique across the workspace, so no repo can overwrite another's
// entry.
//
// **It lives here, out of `useWorktreeSignals.ts`, so it can be falsified.**
// Inside a hook this was four lines no test could reach without a browser, and
// a browser fixture with one project cannot see a cross-project comparison at
// all. As a function it takes plain data and returns plain data, and
// `worktreeOverlapScope.test.mjs` can hand it two repositories and watch the
// boundary hold — or break.
//
// Pure: no React, no Tauri, no client.

import type {
  GroupedWorktrees,
  Repo,
  Worktree,
} from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { WorktreeStats } from "@/features/runs/lib/useWorktreeStats";
import {
  type OverlapInput,
  type WorktreeOverlap,
  worktreeOverlaps,
} from "@/features/runs/lib/worktreeOverlap";
import { usableStat } from "@/features/runs/lib/worktreeStat";

/** One repository's worktrees, as the comparison needs them.
 *
 * Two boundary rules are applied here and nowhere else downstream:
 *
 * - **`usableStat`, never `stats[id]` raw.** An unreadable stat carries an
 *   empty path list that means "git had no answer", not "this worktree changed
 *   nothing" (`worktreeStat.ts`). Read raw, that empty list would silently
 *   agree with every other worktree that they share nothing — and a stat that
 *   is unreadable *and* carries paths (the shape a careless backend or a stale
 *   record could produce) would light up rows off a reading git never made.
 *   `null` here is silence, and silence neither raises a mark nor is named in
 *   one.
 * - **`truncated` comes from `pathsTruncated`, unmodified.** Past the
 *   backend's per-worktree path cap the list is a subset, and every sentence
 *   the model builds from it has to say "at least". Dropping the flag on this
 *   one line would turn a floor into a total — a claim about *all* the files
 *   made from *some* of them — which is the one thing `stat.rs`,
 *   `worktreeStat.ts` and `worktreeOverlap.ts` each separately forbid. */
function repoInputs(
  worktrees: readonly Worktree[],
  stats: WorktreeStats,
): OverlapInput[] {
  return worktrees.map((worktree) => {
    const stat = usableStat(stats[worktree.binding_id]);
    return {
      bindingId: worktree.binding_id,
      label: worktreeSummary(worktree).label,
      paths: stat === null ? null : stat.paths,
      truncated: stat?.pathsTruncated ?? false,
    };
  });
}

/** Every worktree in the workspace that shares a changed file with **another
 * worktree of the same project**, by binding id.
 *
 * Repos are compared one at a time and never against each other — this
 * module's header argues why that is the load-bearing part. A worktree that
 * overlaps nothing has no entry at all, so a renderer cannot draw an empty
 * mark by forgetting to check. */
export function overlapsByRepo({
  grouped,
  repos,
  stats,
}: {
  grouped: GroupedWorktrees;
  repos: readonly Repo[];
  stats: WorktreeStats;
}): ReadonlyMap<string, WorktreeOverlap> {
  const merged = new Map<string, WorktreeOverlap>();
  for (const repo of repos) {
    const inputs = repoInputs(grouped.byRepo[repo.id] ?? [], stats);
    for (const [id, overlap] of worktreeOverlaps(inputs)) {
      merged.set(id, overlap);
    }
  }
  return merged;
}
