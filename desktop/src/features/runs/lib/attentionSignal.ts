// The dot on a worktree row, and the one on the project above it
// (vingilot/docs/plans/2026-08-09-signals-and-dashboards.md, Task 1).
//
// **A dot that guesses is worse than no dot.** It is read from across the room
// and believed without being checked, so the first time it is wrong the owner
// stops looking at it — which costs the surface, not just the row. Every state
// below names the signal it came from, the sentence that names it is produced
// with the state rather than written beside it, and a worktree nothing has
// answered about gets **no dot at all**.
//
// **The four states and their sources of truth.**
//
//   needs-you  `runAttention` says the coordinator's status for the run that
//              owns this worktree is `waiting` — `paused` or `blocked`
//              (`runModel.ts`), which is the same definition the run rail's
//              "needs you" group has always used. Polled every 2s
//              (`usePolling.ts`'s `DEFAULT_INTERVAL_MS`).
//   working    `runAttention` says `active` — provisioning/ready/running/
//              verifying — **or** the one ACP turn this app has in flight was
//              started in this worktree's directory (`askStore.ts`'s
//              `AskInFlight`, pushed through `useAskPending`). The second is
//              not a guess about a terminal: this app spawned that adapter in
//              that cwd and holds the mark until `settleAsk` clears it.
//   dirty      `WorktreeStat.dirty` — git's own numstat of the tree, polled
//              every 5s, single-flight, never blanked by a failed read
//              (`useWorktreeStats.ts`).
//   quiet      git answered *and* said clean, and no run is pressing. It is a
//              real answer and worth drawing: "nothing needs you here." A run
//              that ended `failed` or `cancelled` leaves the tree quiet — the
//              dot reports the tree, and a run ending does not change it — but
//              it is not nothing, and the column's old status dot drew it in
//              `destructive`. So the sentence names the ending, and `rowDetail`
//              puts the same word on the row where no hover is needed to read
//              it. Replacing a signal is not the same as dropping one.
//
// **What is deliberately absent, and why.**
//
// *Terminal liveness.* tmux is probed once per app run and cached for its
// lifetime (`vingilot_pty/tmux.rs`'s `OnceLock`, so `Backing` is one answer for
// the whole app rather than a per-session property), there is no `has-session`
// query anywhere in the island, and no exit event comes back off
// `vingilot://pty` — that channel carries output chunks only. So "a terminal is
// busy in this worktree" is not a question this app can answer today, and
// `working` does not pretend it is one. The tab layout is not a substitute: it
// records what this app opened, which is the app's guess about itself.
//
// *"An answer arrived and has not been seen."* An ask exchange keeps its
// question, its cwd and its answer (`askThread.ts`), and nothing anywhere marks
// one as read. Without a seen mark the state would fire forever on every
// worktree that was ever asked a question, so it is dropped rather than
// approximated.
//
// **Precedence, written down:** needs-you > working > dirty > quiet. It is the
// order of what changes next if nothing is done — a blocked run stays blocked
// until he answers, a running one is moving, uncommitted work is not going
// anywhere. Note this is deliberately *not* `worktreeAttention.ts`'s row
// ordering, which puts dirty first because that list ranks by what can be
// *lost*. Both are right for their surface, and nothing is hidden by the
// difference: a dirty row under a live run still shows its `+`/`−` in
// `rowDetail`.
//
// Pure: no React, no Tauri, no client. `useWorktreeSignals.ts` gathers the
// signals, `ui/AttentionDot.tsx` draws exactly what comes out of here.

import { endedBadly, type RunStatus, runAttention } from "./runModel.ts";
import type { WorktreeStat } from "./worktreeStat.ts";

/** What a dot can say. `null` — no dot — is the fifth outcome and lives in
 * `AttentionMark.state`, because "nothing has answered" is not a state, it is
 * the absence of one. */
export type AttentionState = "needs-you" | "working" | "dirty" | "quiet";

/** Everything known about one worktree that bears on its dot. Each field is a
 * signal that exists today; there is no field here for a signal that would have
 * to be invented. Narrower than `useWorktreeSignals`' own `WorktreeSignals`,
 * which is what a whole screen reads — this is what one dot is derived from. */
export interface DotSignals {
  /** The coordinator's status for the run that owns this worktree; `null` when
   * no run owns it (the project's own checkout, or one the owner made in a
   * shell). */
  runStatus: RunStatus | null;
  /** git's read of the tree. `null` is "no answer" — the read has not landed,
   * or the path could not be read (`usableStat`) — and is never read as
   * clean. */
  stat: WorktreeStat | null;
  /** True when this app's one in-flight ACP turn was started in this
   * worktree's directory. */
  askInFlight: boolean;
}

/** A state and the words that name where it came from, produced together so a
 * tooltip cannot drift from the dot it explains. `state: null` means no dot is
 * drawn, and then `sentence` is empty — there is nothing to say. */
export interface AttentionMark {
  state: AttentionState | null;
  sentence: string;
}

/** The absence of a mark, shared rather than rebuilt: a caller with nothing to
 * draw has to pass *this* absence, not invent a second empty shape that a later
 * change could give a state to. */
export const NO_MARK: AttentionMark = { sentence: "", state: null };

/** The dot for one worktree, and the sentence under it. */
export function attentionMark(signals: DotSignals): AttentionMark {
  const run =
    signals.runStatus === null ? "idle" : runAttention(signals.runStatus);

  if (run === "waiting") {
    return {
      sentence: `needs you — the coordinator says this worktree's run is ${signals.runStatus}`,
      state: "needs-you",
    };
  }
  if (run === "active") {
    return {
      sentence: `working — the coordinator says this worktree's run is ${signals.runStatus}`,
      state: "working",
    };
  }
  if (signals.askInFlight) {
    return {
      sentence:
        "working — this app has an agent turn running in this directory",
      state: "working",
    };
  }
  // Past here the run says nothing, so git is the only witness left — and a git
  // that has not answered leaves the row with no dot rather than a quiet one,
  // because "clean" is a claim and nothing has made it.
  if (signals.stat === null) return NO_MARK;
  if (signals.stat.dirty) {
    return {
      sentence: "uncommitted changes — git's own count of this worktree",
      state: "dirty",
    };
  }
  // A clean tree is the only case where the old status dot said something this
  // one does not: dirty outranked the run's status there too, so an amber
  // square is what a failed run's dirty worktree already drew.
  const ended = endedBadly(signals.runStatus);
  return {
    sentence:
      ended === null
        ? "quiet — git says this worktree is clean and no run is active"
        : `quiet — git says this worktree is clean; the run that owns it ${ended}`,
    state: "quiet",
  };
}

const RANK: Record<AttentionState, number> = {
  dirty: 2,
  "needs-you": 0,
  quiet: 3,
  working: 1,
};

/** True when `a` outranks `b`. Exported because the dashboard orders rows by
 * the same precedence this file writes down, and two copies of an order are
 * two orders. */
export function outranks(a: AttentionState, b: AttentionState): boolean {
  return RANK[a] < RANK[b];
}

/** What one project's row in the sidebar says: the strongest state among its
 * worktrees, so the nav answers "which project needs me" without opening one.
 *
 * A project whose worktrees have all answered nothing gets no dot — including a
 * project with no worktrees at all. Rolling those up to `quiet` would put a
 * "nothing needs you" dot on a project this app has not looked inside, which is
 * the same lie as a guessing row dot, one level up.
 *
 * **The three loud states are existence claims; `quiet` is a universal one.**
 * "2 worktrees need you" stays true however many rows never answered, so a
 * silent sibling cannot falsify it. "nothing needs you — every worktree here is
 * clean" is a claim about all of them, and one silent row makes it a claim
 * about a subset: git was never asked about that tree (an unreadable path, a
 * binding with no derivable cwd), and it may hold uncommitted work. So a single
 * unanswered worktree costs the project its quiet dot rather than being
 * absorbed into a sentence that does not mention it. */
export function rollupMark(marks: readonly AttentionMark[]): AttentionMark {
  let strongest: AttentionState | null = null;
  let count = 0;
  let silent = 0;
  for (const mark of marks) {
    if (mark.state === null) {
      silent += 1;
      continue;
    }
    if (strongest === null || outranks(mark.state, strongest)) {
      strongest = mark.state;
      count = 1;
    } else if (mark.state === strongest) {
      count += 1;
    }
  }
  if (strongest === null) return NO_MARK;
  if (strongest === "quiet" && silent > 0) return NO_MARK;
  return { sentence: rollupSentence(strongest, count), state: strongest };
}

/** The words on a project's dot. They name the signal and not just the state:
 * "2 worktrees need you" alone would leave the owner to guess whether this app
 * asked the coordinator or decided for itself. */
function rollupSentence(state: AttentionState, count: number): string {
  const plural = count === 1 ? "" : "s";
  switch (state) {
    case "needs-you":
      return `${count} worktree${plural} need you — the coordinator says their runs are paused or blocked`;
    case "working":
      return `${count} worktree${plural} working — a coordinator run or an agent turn is in flight`;
    case "dirty":
      return `${count} worktree${plural} dirty — git reports uncommitted changes`;
    case "quiet":
      return "nothing needs you — git says every worktree here is clean";
  }
}
