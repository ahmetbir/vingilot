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
//
// STOP is here for the same reason, and it is the only control on this bar.
// It pauses every live run in the *workspace*, and no single screen owns that
// scope: the Deck lists the workspace's runs, and so does the work surface's
// own Runs tab, unfiltered. A workspace-wide brake parked on either one is
// absent from the other. This bar is the only thing on screen no matter which
// of them the owner is looking at — which also means a latched STOP can always
// be seen and always be released, rather than staying engaged behind a screen
// that does not draw it.

import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeSummary } from "@/features/runs/lib/projects";
import type { PtyBacking } from "@/features/runs/lib/ptyClient";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { wallClock } from "@/features/runs/lib/runModel";
import {
  persistenceCopy,
  SCRATCH_PERSISTENCE,
} from "@/features/runs/lib/terminalPersistence";
import {
  type ControlPlaneKind,
  controlPlaneStatus,
} from "@/features/runs/lib/reachability";
import { StopAllButton } from "@/features/runs/ui/StopAllButton";

interface ProjectStatusBarProps {
  /** `null` on the project-less landing view — the bar renders a neutral
   * placeholder rather than stale project text. */
  repo: Repo | null;
  worktree: Worktree | null;
  /** The worktree's owner run, if it has one — for the wall-clock reading.
   * `null` when the worktree has no owner run, or none was selected. */
  run: RunSummary | null;
  controlPlane: ControlPlaneKind;
  /** What is keeping terminals alive. `null` until the backend has answered
   * — the bar then says nothing about persistence rather than guessing. */
  terminalBacking: PtyBacking | null;
  /** Whether a scratch shell is open right now.
   *
   * It gets a **second** sentence rather than sharing the one above: that one
   * is about the worktree's terminal tabs and would be a lie about this shell,
   * and there is no state of `PtyBacking` that could say so — a scratch is
   * spawned outside tmux whatever the machine has. Only while one is open,
   * because a claim about a shell that is not there is noise. */
  scratchOpen: boolean;
  /** Whether STOP is latched. Owned by `RunsScreen`, which is what actually
   * pauses the runs. */
  stopEngaged: boolean;
  onEngageStop: () => void;
  onReleaseStop: () => void;
}

export function ProjectStatusBar({
  controlPlane,
  onEngageStop,
  onReleaseStop,
  repo,
  run,
  scratchOpen,
  stopEngaged,
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
        {scratchOpen ? (
          <>
            <span
              data-testid="scratch-persistence"
              title={SCRATCH_PERSISTENCE.detail}
            >
              {SCRATCH_PERSISTENCE.label}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        {persistence !== null ? (
          <>
            <span data-testid="terminal-persistence" title={persistence.detail}>
              {persistence.label}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <span>{controlPlaneStatus(controlPlane)}</span>
        <StopAllButton
          engaged={stopEngaged}
          onEngage={onEngageStop}
          onRelease={onReleaseStop}
        />
      </span>
    </footer>
  );
}
