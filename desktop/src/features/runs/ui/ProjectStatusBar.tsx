// The persistent bottom bar naming where the owner is: project · worktree ·
// live state · diff · wall clock · reachability. Answers "what is happening
// right now" without opening anything — the whole point of this plan.

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { wallClock } from "@/features/runs/lib/runModel";

interface ProjectStatusBarProps {
  /** `null` on the project-less landing view — the bar renders a neutral
   * placeholder rather than stale project text. */
  repo: Repo | null;
  worktree: Worktree | null;
  /** The worktree's owner run, if it has one — for the wall-clock reading.
   * `null` when the worktree has no owner run, or none was selected. */
  run: RunSummary | null;
  reachable: boolean;
}

export function ProjectStatusBar({
  reachable,
  repo,
  run,
  worktree,
}: ProjectStatusBarProps) {
  const summary = worktree ? worktreeSummary(worktree) : null;
  const wc = run ? wallClock(run, new Date()) : null;

  return (
    <footer
      className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-1.5 text-2xs text-muted-foreground"
      data-testid="project-status-bar"
    >
      {repo === null ? (
        <span>no project selected</span>
      ) : (
        <>
          <span className="font-medium text-foreground">{repo.name}</span>
          {summary !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{summary.label}</span>
              <span aria-hidden="true">·</span>
              <span>
                {worktree?.owner_run_status ?? "clean"}
                {summary.diff !== null
                  ? ` · +${summary.diff.added} −${summary.diff.removed}`
                  : ""}
              </span>
            </>
          ) : null}
          {wc !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                wall {wc.spentSecs}s
                {wc.limitSecs !== null ? ` / ${wc.limitSecs}s` : ""}
              </span>
            </>
          ) : null}
        </>
      )}
      <span className="ml-auto shrink-0">
        {reachable ? "synced" : "unreachable"}
      </span>
    </footer>
  );
}
