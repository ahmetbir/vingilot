// The persistent bottom bar naming where the owner is: project · worktree ·
// live state · diff · wall clock · terminal persistence · reachability.
// Answers "what is happening right now" without opening anything — the whole
// point of this plan.
//
// The persistence reading is app-wide, not per project, which is why it sits
// with reachability on the right rather than in the project group: tmux is
// detected once per app run (vingilot_pty/tmux.rs), so every terminal in this
// run has the same backing. What it may say is `lib/terminalPersistence.ts`'s
// decision, not this component's.

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { PtyBacking } from "@/features/runs/lib/ptyClient";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { wallClock } from "@/features/runs/lib/runModel";
import { persistenceCopy } from "@/features/runs/lib/terminalPersistence";

interface ProjectStatusBarProps {
  /** `null` on the project-less landing view — the bar renders a neutral
   * placeholder rather than stale project text. */
  repo: Repo | null;
  worktree: Worktree | null;
  /** The worktree's owner run, if it has one — for the wall-clock reading.
   * `null` when the worktree has no owner run, or none was selected. */
  run: RunSummary | null;
  reachable: boolean;
  /** What is keeping terminals alive. `null` until the backend has answered
   * — the bar then says nothing about persistence rather than guessing. */
  terminalBacking: PtyBacking | null;
}

export function ProjectStatusBar({
  reachable,
  repo,
  run,
  terminalBacking,
  worktree,
}: ProjectStatusBarProps) {
  const summary = worktree ? worktreeSummary(worktree) : null;
  const wc = run ? wallClock(run, new Date()) : null;
  const persistence = persistenceCopy(terminalBacking);

  return (
    <footer
      className="flex shrink-0 items-center gap-2 overflow-hidden border-t border-border/60 px-4 py-1.5 text-2xs text-muted-foreground"
      data-testid="project-status-bar"
    >
      <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
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
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap">
        {persistence !== null ? (
          <>
            <span data-testid="terminal-persistence" title={persistence.detail}>
              {persistence.label}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span>{reachable ? "synced" : "unreachable"}</span>
      </span>
    </footer>
  );
}
