// The persistent bottom bar naming where the owner is: project · worktree ·
// live state · diff · wall clock · live agent · terminal persistence ·
// reachability. Answers "what is happening right now" without opening anything
// — the whole point of this plan.
//
// **The live-agent segment is the one thing on this bar that fetches**
// (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 3). Every other
// reading arrives as a prop from `RunsScreen`, and this one deliberately does
// not: it subscribes to the same shared poller the attention dots read
// (`lib/useLiveAgents.ts`), so the bar and the dot for one worktree are two
// renderings of one object rather than two readings that can disagree. Passing
// it down instead would put the same object through a screen that is one line
// under the repository's file-size ratchet and has no other reason to hold it.
//
// It says nothing when there is no session, which is the honest shape: absence
// of hooks is "no answer", never "the terminal is idle" (`state.rs`'s decay).
//
// The persistence reading is app-wide, not per project, which is why it sits
// with reachability on the right rather than in the project group: tmux is
// detected once per app run (vingilot_pty/tmux.rs), so every terminal in this
// run has the same backing. What it may say is `lib/terminalPersistence.ts`'s
// decision, not this component's.
//
// Two of the facts are also doors, VS Code's model: clicking a status item
// opens the surface that explains it. The branch/diff segment opens the
// History pane (`showPane("history")` — the same act the sidebar's History
// member fires), and the control-plane word opens Settings' Home-harbor card,
// which is where `harborStart/Stop` live and therefore the one place the word
// can be acted on. Both are real buttons with the quiet hover ramp, and both
// exist only while their fact does — a door on a fact that is not there would
// be a click that goes nowhere.
//
// STOP is here for the same reason, and it is the only control on this bar.
// It pauses every live run in the *workspace*, and no single screen owns that
// scope: the Deck lists the workspace's runs, and so does the work surface's
// own Runs tab, unfiltered. A workspace-wide brake parked on either one is
// absent from the other. This bar is the only thing on screen no matter which
// of them the owner is looking at — which also means a latched STOP can always
// be seen and always be released, rather than staying engaged behind a screen
// that does not draw it.

import { agentFor, agentSegment } from "@/features/runs/lib/liveAgents";
import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeCwd, worktreeSummary } from "@/features/runs/lib/projects";
import { useLiveAgents } from "@/features/runs/lib/useLiveAgents";
import { useWorktreeRoot } from "@/features/runs/lib/useWorktreeRoot";
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
  /** Opens the History pane — the surface that explains the branch/diff fact. */
  onShowHistory: () => void;
  /** Opens Settings' Home-harbor card — where the control-plane word is acted on. */
  onShowControlPlane: () => void;
}

/** The persistence claims, as one readable unit.
 *
 * The plate shows the copy's `short` — a glance word — and carries the label
 * and detail together in its tooltip: a sentence in the `·`-separated run
 * dissolves into the punctuation around it and stops being read as a claim
 * about anything in particular. Which words a short may use is
 * `terminalPersistence.ts`'s rule, not this component's.
 *
 * **The plate's colour is the claim's weight.** tmux — terminals that survive
 * the app — is the quiet muted plate: nothing to warn about. A backing whose
 * terminals die with the app, and the scratch shell that keeps nothing, wear
 * `badge.tsx`'s warning treatment instead: amber is the app's "state you could
 * lose" hue (the AttentionDot's dirty square, the Diff pane's omission line),
 * and a warning-shaped fact in a quiet plate is a warning nobody reads.
 *
 * Horizontal padding only, deliberately. Vertical padding here would grow the
 * bar itself, and this bar's height is the one thing about it every screen
 * underneath is laid out against. */
const QUIET_PLATE = "rounded bg-muted/60 px-1.5";
const WARNING_PLATE =
  "rounded bg-amber-500/15 px-1.5 text-amber-600 dark:text-amber-400";

/** The doors' hover ramp — the app's quiet one (the escape-hatch dismiss,
 * the scratch close), horizontal padding only for the bar-height reason the
 * plates give. The negative margin cancels the padding at rest, so a fact
 * that becomes a door does not move. */
const DOOR =
  "-mx-1 rounded-sm px-1 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function ProjectStatusBar({
  controlPlane,
  onEngageStop,
  onReleaseStop,
  onShowControlPlane,
  onShowHistory,
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
  const agents = useLiveAgents();
  // The bar names the worktree it is standing in, so it asks about that one —
  // by binding id, and by directory for the rows whose id the backend cannot
  // derive from a path (`liveAgents.ts`'s header). The directory is the same
  // derivation every other surface uses, from the same one-per-app-run lookup
  // `useMachineFacts` reads.
  const { worktreeRoot } = useWorktreeRoot();
  const cwd =
    repo === null || worktree === null || worktreeRoot === null
      ? null
      : worktreeCwd(repo, worktree, worktreeRoot);
  const agent = agentSegment(
    worktree === null ? null : agentFor(agents, worktree.binding_id, cwd),
  );

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
                {/* The branch and the diff are one door: History is the
                 * surface that explains both. */}
                <button
                  className={`flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap ${DOOR}`}
                  data-testid="statusbar-history"
                  onClick={onShowHistory}
                  title="Open History"
                  type="button"
                >
                  <span>{summary.label}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {worktree?.owner_run_status ?? "clean"}
                    {summary.diff !== null
                      ? ` · +${summary.diff.added} −${summary.diff.removed}`
                      : ""}
                  </span>
                </button>
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
        {/* The quiet plate, not the warning one: a working agent is not a
         * state he could lose, and amber is spoken for by the two persistence
         * claims beside it. Absent entirely when no session has spoken, which
         * is what keeps this bar's height and its right-hand run unchanged on
         * every screen that has no agent in it (`workspace-one-column`'s
         * geometry). */}
        {agent !== null ? (
          <>
            <span className={QUIET_PLATE} data-testid="live-agent">
              {agent}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        {scratchOpen ? (
          <>
            <span
              className={WARNING_PLATE}
              data-backing="scratch"
              data-testid="scratch-persistence"
              title={`${SCRATCH_PERSISTENCE.label}\n\n${SCRATCH_PERSISTENCE.detail}`}
            >
              {SCRATCH_PERSISTENCE.short}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        {persistence !== null ? (
          <>
            <span
              className={
                terminalBacking === "tmux" ? QUIET_PLATE : WARNING_PLATE
              }
              data-backing={terminalBacking}
              data-testid="terminal-persistence"
              title={`${persistence.label}\n\n${persistence.detail}`}
            >
              {persistence.short}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <button
          className={DOOR}
          data-testid="statusbar-control-plane"
          onClick={onShowControlPlane}
          title="Open the Home harbor settings"
          type="button"
        >
          {controlPlaneStatus(controlPlane)}
        </button>
        <StopAllButton
          engaged={stopEngaged}
          onEngage={onEngageStop}
          onRelease={onReleaseStop}
        />
      </span>
    </footer>
  );
}
