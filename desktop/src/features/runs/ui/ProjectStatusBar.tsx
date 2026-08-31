// The persistent bottom bar naming where the owner is: project · worktree ·
// live state · diff · wall clock · live agent · terminal persistence ·
// reachability — plus, since redesign P4, the mockup's own card treatment
// (`.status`, Vingilot.html:327), the working crew's live turns, and the
// quick-action row (Stop / Review / configurable canned prompts).
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
// be a click that goes nowhere. P4 adds a third: the relay word, the same
// `relayStatus.canReconnect` rule `ChatStatusBar` already keeps.
//
// STOP is here for the same reason it always was, and it is the only control
// that survives on the landing view. It pauses every live run in the
// *workspace*, and no single screen owns that scope: the Deck lists the
// workspace's runs, and so does the work surface's own Runs tab, unfiltered.
// A workspace-wide brake parked on either one is absent from the other. This
// bar is the only thing on screen no matter which of them the owner is
// looking at — which also means a latched STOP can always be seen and always
// be released, rather than staying engaged behind a screen that does not draw
// it.
//
// **P4's two new segments, both real, neither the mockup's invented numbers**
// (mockup `.sg`: "2 agents · Bosun · Lookout", "42.1k tok · $1.86"):
// - `StatusBarWorkingAgents` reads which crew members have an active ACP turn
//   in THIS worktree's team thread right now — a different signal from the
//   live-agent plate above (that one is a coding agent inside a terminal
//   session; this one is the buzz-relay crew). Renders nothing when nobody
//   is working.
// - Tokens + cost has NO real source anywhere in this app (no aggregate
//   token counter, no cost figure at all) and is omitted entirely rather than
//   invented — the phase's single highest-risk rule, kept literally.
// - CI is omitted too: `DockChecksPanel`'s own header already establishes
//   there is no checks/PR read in this backend before P5's `gh` island.
//
// **The quick-action row** (`StatusBarQuickActions`) is the owner's own
// feature: configurable canned prompts that type into the ACTIVE terminal
// session, with two declared exceptions (Stop keeps its real behavior,
// Review dispatches to an agent instead of typing) — see that component's
// header for the full reasoning. It renders only once a worktree is
// selected: "Commit" and "Create PR" are worktree-shaped concepts, and a
// button for one over the project-less landing view would be a click into
// nothing. STOP alone survives there, unconditionally, per the paragraph
// above.

import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { relayStatus } from "@/features/channels/lib/relayStatus";
import { agentFor, agentSegment } from "@/features/runs/lib/liveAgents";
import type { Repo, Worktree } from "@/features/runs/lib/projects";
import { worktreeCwd, worktreeSummary } from "@/features/runs/lib/projects";
import type { PtyBacking } from "@/features/runs/lib/ptyClient";
import { quickActionVarsForWorktree } from "@/features/runs/lib/quickActions";
import {
  type ControlPlaneKind,
  controlPlaneStatus,
} from "@/features/runs/lib/reachability";
import type { RunSummary } from "@/features/runs/lib/runModel";
import { wallClock } from "@/features/runs/lib/runModel";
import {
  bindingFor,
  readTeamThreadBindings,
} from "@/features/runs/lib/teamThreadStore";
import {
  persistenceCopy,
  SCRATCH_PERSISTENCE,
} from "@/features/runs/lib/terminalPersistence";
import { useLiveAgents } from "@/features/runs/lib/useLiveAgents";
import { useReviewDispatch } from "@/features/runs/lib/useReviewDispatch";
import { useWorktreeRoot } from "@/features/runs/lib/useWorktreeRoot";
import { StatusBarQuickActions } from "@/features/runs/ui/StatusBarQuickActions";
import { StatusBarWorkingAgents } from "@/features/runs/ui/StatusBarWorkingAgents";
import { StopAllButton } from "@/features/runs/ui/StopAllButton";
import { useReconnectRelay } from "@/shared/api/useReconnectRelay";
import { useRelayConnection } from "@/shared/api/useRelayConnection";
import { readVingilotQuickActions } from "@/shared/theme/vingilot-quick-actions";
import { VINGILOT_CARD_CLASS } from "@/shared/ui/vingilotCard";

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
  /** Whether the SELECTED worktree's active terminal tab is one this bar can
   * type into — `RunsScreen`'s own state (`useActiveTerminalTyping.ts`), not
   * derivable from anything this component already has. */
  canType: boolean;
  /** Types text + Enter into the active terminal session. A no-op door: this
   * component only ever calls it from a button already gated on `canType`. */
  onQuickAction: (text: string) => void;
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
  canType,
  controlPlane,
  onEngageStop,
  onQuickAction,
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

  // The crew's working-agents segment and Review's reviewer roster both read
  // this same query result — one fetch, two readers, react-query's own cache
  // making the second read free.
  const managedAgents = useManagedAgentsQuery().data ?? [];
  const threadChannelId =
    worktree === null
      ? null
      : (bindingFor(readTeamThreadBindings(), worktree.binding_id)?.channelId ??
        null);
  const review = useReviewDispatch(worktree?.binding_id ?? null);

  // Read once per mount, the `vingilot-crew-position.ts` idiom: Settings and
  // this bar are never mounted together (Settings replaces the workspace
  // route), so there is no live-update case to serve.
  const [quickActionButtons] = React.useState(readVingilotQuickActions);
  const quickActionVars = quickActionVarsForWorktree(worktree, cwd);

  const relayConnectionState = useRelayConnection();
  const relay = relayStatus(relayConnectionState);
  const { isPending: relayReconnectPending, reconnect } = useReconnectRelay();

  return (
    <footer
      className={`flex h-9 shrink-0 items-center overflow-hidden px-2 text-2xs text-foreground/55 ${VINGILOT_CARD_CLASS}`}
      data-testid="project-status-bar"
    >
      {/* mockup `.sg`: project · branch/diff door · wall clock. */}
      <span className="flex h-4 min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap px-3.5">
        {repo === null ? (
          <span>no project selected</span>
        ) : (
          <>
            <span className="font-semibold text-foreground/90">
              {repo.name}
            </span>
            {summary !== null ? (
              <>
                <span aria-hidden="true">·</span>
                {/* The branch and the diff are one door: History is the
                 * surface that explains both. */}
                <button
                  className={`flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap font-mono ${DOOR}`}
                  data-testid="statusbar-history"
                  onClick={onShowHistory}
                  title="Open History"
                  type="button"
                >
                  <span>{summary.label}</span>
                  <span aria-hidden="true">·</span>
                  <span>{worktree?.owner_run_status ?? "clean"}</span>
                  {summary.diff !== null ? (
                    <>
                      <span className="text-status-added">
                        +{summary.diff.added}
                      </span>
                      {/* The shared diff token, deliberately: a P4 reading
                       * put it at 4.11:1 here and swapped in rose-400, but
                       * the independent verify re-measured `--status-deleted`
                       * (#ea4a5a) on this ground at 4.66:1 — it passes, and
                       * the first reading had sampled antialiased glyph
                       * edges rather than their cores. Fragmenting the colour
                       * that WorktreeDiffPanel, HistoryPatch, PatchView and
                       * ActivityRow all share was not worth a margin that
                       * was never there. It IS tight and theme-dependent
                       * (the token comes from gitColors.deleted), so a theme
                       * that darkens it should be re-measured here. */}
                      <span className="text-status-deleted">
                        −{summary.diff.removed}
                      </span>
                    </>
                  ) : null}
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

      <StatusBarWorkingAgents
        agents={managedAgents}
        threadChannelId={threadChannelId}
      />

      {/* mockup `.sg`: the hook-liveness agent, terminal persistence, relay,
       * and the control-plane door — bundled the way the mockup bundles
       * CI/relay/tmux into one segment. */}
      <span className="flex h-4 shrink-0 items-center gap-2 whitespace-nowrap border-l border-foreground/[.08] px-3.5">
        {/* The quiet plate, not the warning one: a working agent is not a
         * state he could lose, and amber is spoken for by the two persistence
         * claims beside it. Absent entirely when no session has spoken. */}
        {agent !== null ? (
          <span className={QUIET_PLATE} data-testid="live-agent">
            {agent}
          </span>
        ) : null}
        {scratchOpen ? (
          <span
            className={WARNING_PLATE}
            data-backing="scratch"
            data-testid="scratch-persistence"
            title={`${SCRATCH_PERSISTENCE.label}\n\n${SCRATCH_PERSISTENCE.detail}`}
          >
            {SCRATCH_PERSISTENCE.short}
          </span>
        ) : null}
        {persistence !== null ? (
          <span
            className={terminalBacking === "tmux" ? QUIET_PLATE : WARNING_PLATE}
            data-backing={terminalBacking}
            data-testid="terminal-persistence"
            title={`${persistence.label}\n\n${persistence.detail}`}
          >
            {persistence.short}
          </span>
        ) : null}
        {/* The mockup's "relay" dot (`.sg`: "relay ✓") — the same
         * `useRelayConnection`/`relayStatus` reading `ChatStatusBar` already
         * surfaces for a channel, now on the workspace bar too. A word when
         * healthy, a button exactly when clicking it would reconnect
         * (`relayStatus.canReconnect`) — never a control that does nothing.
         * The mockup's checkmark green is worn ONLY by the truly-connected
         * word: "connecting"/"reconnecting" are `canReconnect: false` too
         * (mid-flight, not yet a fact worth a checkmark) and stay the bar's
         * plain ambient color, `ChatStatusBar`'s own neutral treatment for
         * every non-button state. */}
        {relay.canReconnect ? (
          <button
            className={DOOR}
            data-state={relayConnectionState}
            data-testid="statusbar-relay"
            disabled={relayReconnectPending}
            onClick={() => void reconnect()}
            title={relay.detail}
            type="button"
          >
            relay {relay.word}
          </button>
        ) : (
          <span
            className={
              relayConnectionState === "connected" ? "text-emerald-500" : ""
            }
            data-state={relayConnectionState}
            data-testid="statusbar-relay"
            title={relay.detail}
          >
            relay {relay.word}
          </span>
        )}
        <button
          className={DOOR}
          data-testid="statusbar-control-plane"
          onClick={onShowControlPlane}
          title="Open the Home harbor settings"
          type="button"
        >
          {controlPlaneStatus(controlPlane)}
        </button>
      </span>

      {/* mockup `.sgrow`: the flexible gap before the buttons — no border of
       * its own (the mockup zeroes it explicitly, `.sgrow{border-right:0}`). */}
      <span className="flex-1" />

      {worktree === null ? (
        // Commit/Create PR/Review are worktree-shaped; STOP alone survives
        // the landing view, unconditionally, per this file's header.
        <StopAllButton
          engaged={stopEngaged}
          onEngage={onEngageStop}
          onRelease={onReleaseStop}
        />
      ) : (
        <StatusBarQuickActions
          buttons={quickActionButtons}
          canType={canType}
          onEngageStop={onEngageStop}
          onQuickAction={onQuickAction}
          onReleaseStop={onReleaseStop}
          review={review}
          stopEngaged={stopEngaged}
          vars={quickActionVars}
        />
      )}
    </footer>
  );
}
