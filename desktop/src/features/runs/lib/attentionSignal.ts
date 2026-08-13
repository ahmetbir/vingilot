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
//   needs-you  *or* an agent in this worktree's terminal is stopped at a
//              permission prompt — `hook_liveness` says `asking`
//              (`lib/liveAgents.ts`, `vingilot_hooks`). A question aimed at a
//              person that nothing else on this screen can see.
//   working    *or* an agent in this worktree's terminal is mid-turn —
//              `hook_liveness` says `working`. Not a guess about a terminal
//              either: the agent's own hooks said so, and a session that stops
//              saying so is removed rather than left green (`state.rs`'s decay
//              is why this is trustworthy at all).
//   quiet      git answered *and* said clean, and no run is pressing. It is a
//              real answer and worth drawing: "nothing needs you here." A run
//              that ended `failed` or `cancelled` leaves the tree quiet — the
//              dot reports the tree, and a run ending does not change it — but
//              it is not nothing, and the column's old status dot drew it in
//              `destructive`. So the sentence names the ending, and `rowDetail`
//              puts the same word on the row where no hover is needed to read
//              it. Replacing a signal is not the same as dropping one. The mark
//              *carries* the ending as well as naming it (`AttentionMark.ended`)
//              because every sentence rolled up from these marks — the project
//              dot's and the board's headline — makes the same claim over a
//              whole set and would otherwise make it without the one fact that
//              contradicts it.
//
// **Terminal liveness, and where it sits.** This used to be the first entry
// under "deliberately absent": tmux is probed once per app run and cached, no
// `has-session` query exists in the island, and `vingilot://pty` carries output
// chunks only — so "a terminal is busy in this worktree" was not a question
// this app could answer, and `working` did not pretend it was one. Ring 1 of
// the hook injection answers it now, from the agent's own mouth rather than
// from anything this app inferred: a `claude` launched in one of our terminals
// posts `UserPromptSubmit`, `PreToolUse` and `Notification` to a loopback
// endpoint, and a session that stops posting is *removed* from the store rather
// than left at its last word.
//
// **It goes in below dirty, deliberately.** The existing precedence is
// untouched — a run's status and an uncommitted tree still outrank it — because
// those are claims this app has made for weeks and the owner reads them without
// checking. What terminal liveness fills is the *silence*: the rows that today
// have no dot at all (git has not answered) and the rows that say `quiet`,
// where "nothing needs you here" is exactly wrong while an agent in that
// directory is stopped at a permission prompt. The cost is stated rather than
// hidden: an `asking` agent in a **dirty** worktree still draws `dirty`, and
// the sentence under the dot is git's. That is the conservative half of the
// trade, and the bottom bar's segment (`liveAgents.ts`) is where the selected
// worktree's agent is visible regardless of what its dot says.
//
// A worktree's *ending* (`AttentionMark.ended`) is dropped on the agent
// branches for the same reason `dirty` drops it: a row whose sentence does not
// name the run that stopped may not carry it into a rollup that would.
//
// **What is deliberately absent, and why.**
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

import type { AgentLiveness } from "./liveAgents.ts";
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
  /** What an agent in this worktree's *terminal* is doing — the hook
   * endpoint's answer (`lib/liveAgents.ts`). `null` is "no live session", which
   * is the ordinary case and says nothing: the store forgets a session that has
   * gone silent, so absence here is never "the agent finished". */
  agent: AgentLiveness | null;
}

/** A state and the words that name where it came from, produced together so a
 * tooltip cannot drift from the dot it explains. `state: null` means no dot is
 * drawn, and then `sentence` is empty — there is nothing to say. */
export interface AttentionMark {
  state: AttentionState | null;
  sentence: string;
  /** The status of the run that owns this worktree when it stopped without
   * finishing — `failed` or `cancelled` (`endedBadly`) — and `null` everywhere
   * else.
   *
   * **Set only where the mark's own sentence names it,** which today is `quiet`
   * alone: a dirty tree outranked its run's status on the old status dot too,
   * so its row says nothing about the ending and neither may anything summing
   * that row up. The field exists because a state is not enough to sum a set
   * of these honestly — `rollupMark` is handed marks and nothing else, so
   * without this it can only say "nothing needs you" over a project whose run
   * failed. */
  ended: RunStatus | null;
}

/** The absence of a mark, shared rather than rebuilt: a caller with nothing to
 * draw has to pass *this* absence, not invent a second empty shape that a later
 * change could give a state to. */
export const NO_MARK: AttentionMark = {
  ended: null,
  sentence: "",
  state: null,
};

/** The dot for one worktree, and the sentence under it. */
export function attentionMark(signals: DotSignals): AttentionMark {
  const run =
    signals.runStatus === null ? "idle" : runAttention(signals.runStatus);

  if (run === "waiting") {
    return {
      ended: null,
      sentence: `needs you — the coordinator says this worktree's run is ${signals.runStatus}`,
      state: "needs-you",
    };
  }
  if (run === "active") {
    return {
      ended: null,
      sentence: `working — the coordinator says this worktree's run is ${signals.runStatus}`,
      state: "working",
    };
  }
  if (signals.askInFlight) {
    return {
      ended: null,
      sentence:
        "working — this app has an agent turn running in this directory",
      state: "working",
    };
  }
  // Past here the run says nothing, so git and the terminal are the witnesses
  // left. git goes first — see this module's header for why the existing
  // precedence keeps its place and terminal liveness fills the silence under
  // it.
  // `?.` rather than a null check and a read: a stat nobody has answered
  // with is not dirty, and the two spellings mean the same thing here.
  if (signals.stat?.dirty) {
    return {
      ended: null,
      sentence: "uncommitted changes — git's own count of this worktree",
      state: "dirty",
    };
  }
  if (signals.agent !== null && signals.agent.state !== "waiting") {
    // `waiting` is not drawn: a session sitting at its prompt is a live agent
    // that needs nothing and is doing nothing, and a dot for it would outrank
    // this worktree's real answer — that git says it is clean — with a fact
    // about a shell.
    const asking = signals.agent.state === "asking";
    return {
      ended: null,
      sentence: `${asking ? "needs you" : "working"} — ${agentPhrase(signals.agent)}`,
      state: asking ? "needs-you" : "working",
    };
  }
  // A git that has not answered leaves the row with no dot rather than a quiet
  // one, because "clean" is a claim and nothing has made it.
  if (signals.stat === null) return NO_MARK;
  // A clean tree is the only case where the old status dot said something this
  // one does not: dirty outranked the run's status there too, so an amber
  // square is what a failed run's dirty worktree already drew.
  const ended = endedBadly(signals.runStatus);
  return {
    ended,
    sentence:
      ended === null
        ? "quiet — git says this worktree is clean and no run is active"
        : `quiet — git says this worktree is clean; the run that owns it ${ended}`,
    state: "quiet",
  };
}

/** The half of an agent's sentence that names where it came from and what it is
 * doing — "an agent in this worktree's terminal is waiting for approval: Bash".
 *
 * **Built from `state` and `tool`, never by re-wording the backend's own
 * sentence and never by parsing it.** The bar renders that sentence whole; this
 * one has to read as a clause inside a dot's sentence, and the two are the same
 * facts in two grammars rather than one string used twice.
 *
 * Several sessions get the plural and lose the tool, matching the rollup the
 * backend already does: one session's `Bash` reported over two agents is a
 * claim about the other one that nothing made. */
function agentPhrase(agent: AgentLiveness): string {
  const doing = agent.state === "asking" ? "waiting for approval" : "working";
  if (agent.sessions > 1) {
    return `${agent.sessions} agents in this worktree's terminals are ${doing}`;
  }
  const on = agent.tool === null ? "" : `: ${agent.tool}`;
  return `an agent in this worktree's terminal is ${doing}${on}`;
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
 * absorbed into a sentence that does not mention it.
 *
 * **A quiet set with a run that stopped in it does not say "nothing needs
 * you".** The row-level sentence names that ending and this one has to as well
 * — it is read from further away and by a surface that draws no rows at all
 * (the Deck's headline, `triage.ts`). The endings reach here on the marks
 * themselves (`AttentionMark.ended`); a state alone cannot carry them, and
 * re-deriving them beside the marks would be the second opinion about one
 * worktree this module exists to prevent. */
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
  return {
    // The rollup speaks for many worktrees, so it names their endings in its
    // own sentence rather than carrying one worktree's: a set has no single
    // owning run to report.
    ended: null,
    sentence: rollupSentence(strongest, count, endedNote(marks)),
    state: strongest,
  };
}

/** What the runs that stopped without finishing add to a sentence that would
 * otherwise say nothing is pressing — `""` when none of these marks names one.
 *
 * Exported because `rollupMark` is not the only place that sentence is written:
 * when it withholds a state (a quiet set with one worktree nothing has answered
 * about) the board writes its own (`triage.ts`), and that sentence makes the
 * same claim over the same rows. One vocabulary, in the module the marks come
 * from, rather than the same fact worded twice.
 *
 * Only `quiet` marks carry an ending, so this counts the clean trees whose run
 * stopped — never a dirty one, whose row says nothing about its run either. */
export function endedNote(marks: readonly AttentionMark[]): string {
  const endings = marks.flatMap((mark) =>
    mark.ended === null ? [] : [mark.ended],
  );
  if (endings.length === 0) return "";
  const runs = `${endings.length} run${endings.length === 1 ? "" : "s"} here`;
  const distinct = new Set(endings);
  // Two runs that ended the same way are named by that word; a mixed set gets
  // the definition `endedBadly` is, because the rows below say which is which.
  const [only] = distinct;
  return distinct.size === 1
    ? `, but ${runs} ${only}`
    : `, but ${runs} stopped without finishing`;
}

/** The words on a project's dot. They name the signal and not just the state:
 * "2 worktrees need you" alone would leave the owner to guess whether this app
 * asked the coordinator or decided for itself.
 *
 * Verbs agree with the count as well as the noun: this sentence is a headline
 * over a whole board (`triage.ts`) as well as a tooltip, and "1 worktree need
 * you" is read as a typo by everyone who reads it, which costs the surface the
 * same credibility a wrong dot does. */
function rollupSentence(
  state: AttentionState,
  count: number,
  ended: string,
): string {
  const many = count !== 1;
  const worktrees = `${count} worktree${many ? "s" : ""}`;
  switch (state) {
    case "needs-you":
      return `${worktrees} ${many ? "need" : "needs"} you — the coordinator says ${many ? "their runs are" : "its run is"} paused or blocked`;
    case "working":
      return `${worktrees} ${many ? "are" : "is"} working — a coordinator run or an agent turn is in flight`;
    case "dirty":
      return `${worktrees} ${many ? "are" : "is"} dirty — git reports uncommitted changes`;
    case "quiet":
      return ended === ""
        ? "nothing needs you — git says every worktree here is clean"
        : `git says every worktree here is clean${ended}`;
  }
}
