// A conversation with a Buzz agent team, about one worktree
// (vingilot/docs/plans/2026-08-08-scratch-and-team-thread.md, Task 2).
//
// **The plan's premise is wrong, and the survey is followed instead.** The plan
// says "a Buzz agent team does have its own identity"; it does not. A team is a
// local JSON record — `{id, name, description, instructions, personaIds[]}`
// (`managed_agents/teams.rs`) — with no key of its own, mirrored to the relay
// as a kind:30176 addressable event **signed with the owner's keys**
// (`commands/teams.rs`). A persona is a definition and has no key either.
//
// What *does* hold a key is each **managed agent instance**, minted at deploy
// time with `Keys::generate()` (`commands/agents.rs`). Deploying a team is a
// fan-out into one such agent per persona, and each of those signs its own
// messages. So the correct form of the argument that puts this conversation on
// the relay is:
//
//   the members of a team each post under their own pubkey; the team as such
//   never posts at all.
//
// That is still enough, and it is still the whole reason this pane is not
// ask-mode. The local ACP adapter holds no key (`askThread.ts`), so landing its
// answers in a channel would mean signing an agent's words with the owner's
// identity. A deployed team member signs its own. Nothing here forges an
// author, so nothing here needs a store of its own — and this file must never
// grow one. `teamThreadStore.ts` keeps a *pointer* (which channel a worktree's
// thread is) and no message ever.
//
// Pure: the sentences, the reading, and what a message is made of. Every
// question below is asked live by the pane rather than by a `PaneProbe`,
// because a probe is asked once and all four of these change while the owner is
// looking at them — a relay drops, a team is added in another window.

import type { ConnectionState } from "@/shared/api/relayClientShared";

import type { PaneAvailability, PaneContext } from "./paneModel.ts";

/** The one line of context that rides in front of every message this pane
 * sends. Exported because the sentence that *describes* it and the message that
 * *carries* it must be the same string — a scope claim assembled separately
 * from the send is a claim about nothing. */
export const SCOPE_PREFIX = "worktree: ";

/** How many teams are configured, or why that is not a number yet.
 *
 * `"unknown"` is the question that could not be put — a distinct thing from
 * `0`, which is the world answering none. Collapsing them is the mistake this
 * island keeps having to unlearn. */
export type TeamCount = "asking" | "unknown" | number;

/** Whether the relay can be reached. Mapped from upstream's connection state by
 * the pane; the reading below never sees a socket. */
export type RelayReach = "asking" | "reachable" | "unknown" | "unreachable";

export interface TeamThreadFacts {
  /** Whether a community is joined at all.
   *
   * A plain boolean, and the only one here: the community list is this app's
   * own local config rather than something it asks a server for, so `null` is
   * not a state it can be in. Every other question below can fail to be put. */
  community: boolean;
  teams: TeamCount;
  relay: RelayReach;
}

/** Upstream's socket state, read as an answer about the relay.
 *
 * **`idle` is `unknown`, and that is the whole reason this is a function.** It
 * means nothing has asked the socket to open yet — the workspace screen reaches
 * the relay through Tauri commands and only opens a socket when a thread
 * subscribes — so it is a question this app has not put, not a relay that
 * answered no. Reading it as either "connecting" or "unreachable" would be the
 * empty read this project keeps making. */
export function relayReach(state: ConnectionState): RelayReach {
  switch (state) {
    case "connected":
      return "reachable";
    case "connecting":
    case "reconnecting":
      return "asking";
    case "disconnected":
    case "stalled":
      return "unreachable";
    case "idle":
      return "unknown";
  }
}

/** What the pane can say about itself before a word is typed.
 *
 * `unsure` is separate from `blocked` on purpose and is the rule this task is
 * judged on: **"could not ask" is never rendered as "no".** An unsure pane
 * stays open — a build that could not put the question has not been told the
 * answer is no. */
export type TeamThreadReading =
  | { status: "ready" }
  | { status: "waiting"; note: string }
  | { status: "unsure"; note: string }
  | { status: "blocked"; reason: string };

export const NO_COMMUNITY =
  "No community is joined here. This conversation is held on the relay — that is what keeps the team members' words theirs rather than yours — so with no community there is nowhere for it to be.";

export const TEAMS_ASKING = "Asking which agent teams are configured…";

export const TEAMS_UNKNOWN =
  "This app could not ask which agent teams are configured. That is no answer rather than an answer of none, so nothing here is a refusal — the question is worth putting again.";

export const NO_TEAMS =
  "No agent team is configured. A team is a named list of personas, made under Agents → Teams; this pane deploys one agent per member and talks to them.";

export const RELAY_ASKING = "Connecting to the relay…";

export const RELAY_UNKNOWN =
  "This app could not tell whether the relay is reachable. That is no answer rather than an answer of no, so the thread stays open and a send that cannot leave will say so itself.";

/** What an unreachable relay costs, said as what this pane *does* — which is
 * put everything away. `canSend` refuses on a blocked reading, so the composer
 * is not rendered at all: the old sentence ("nothing typed here would go
 * anywhere") described typing into a box that is not on screen, and left the
 * thread's disappearance unexplained beside it. */
export const RELAY_UNREACHABLE =
  "The relay is not reachable. This conversation lives there and not in this app, so until it is back this pane can neither show the thread nor take a message for it. Nothing is lost by waiting: the channel and everything said in it are on the relay, and anything half-written here is kept on this machine.";

/** The pane's own verdict, from the three questions it asks the world live.
 *
 * **Order is a decision.** The community and the team list are things the owner
 * would go and set up; the relay is a condition that passes on its own. Naming
 * a transient before a structural blocker would send him to fix the wrong
 * thing, so those two are reported first even when all three are true at once.
 * Within each question, "could not ask" outranks "still asking" outranks the
 * answer, because the first two are statements about this app and only the
 * third is a statement about the world. */
export function readTeamThread(facts: TeamThreadFacts): TeamThreadReading {
  if (!facts.community) return { reason: NO_COMMUNITY, status: "blocked" };
  if (facts.teams === "unknown") {
    return { note: TEAMS_UNKNOWN, status: "unsure" };
  }
  if (facts.teams === "asking") {
    return { note: TEAMS_ASKING, status: "waiting" };
  }
  if (facts.teams <= 0) return { reason: NO_TEAMS, status: "blocked" };
  if (facts.relay === "unknown") {
    return { note: RELAY_UNKNOWN, status: "unsure" };
  }
  if (facts.relay === "asking") {
    return { note: RELAY_ASKING, status: "waiting" };
  }
  if (facts.relay === "unreachable") {
    return { reason: RELAY_UNREACHABLE, status: "blocked" };
  }
  return { status: "ready" };
}

/** True while this reading still lets the owner type. `unsure` does, which is
 * the whole of the rule; `waiting` does not, because a composer that accepts a
 * message before the socket is up has to hold it somewhere, and holding it is
 * how a fourth store starts. */
export function canSend(reading: TeamThreadReading): boolean {
  return reading.status === "ready" || reading.status === "unsure";
}

/** Whether this pane can stand in this worktree at all.
 *
 * Only the directory, deliberately. The other three questions — community,
 * teams, relay — are live and are answered inside the pane, because
 * `PaneProbe`s are asked once per key and these three change under the owner's
 * hands. Gating the frame on a snapshot of them would mean a pane that says
 * "no teams" ten minutes after one was made. */
export function teamAvailability(ctx: PaneContext): PaneAvailability {
  if (ctx.cwd !== null) return { status: "available" };
  if (ctx.cwdPending) {
    return { note: "waiting for this worktree's checkout…", status: "pending" };
  }
  return {
    reason:
      "this worktree has no directory this app can name, so there is nothing to tell a team this conversation is about.",
    status: "unavailable",
  };
}

/** The line itself. */
export function scopeLine(cwd: string): string {
  return `${SCOPE_PREFIX}${cwd}`;
}

/** What the pane prints above the composer, quoting the line it will actually
 * send. Ask-mode's rule, kept word for word: state the context that goes, then
 * enumerate what does not — and here, two things more that ask-mode does not
 * have to say.
 *
 * The first: a managed agent is spawned once in `~/.buzz` (or `$HOME`) and
 * never in a per-message directory (`managed_agents/mod.rs`), so the path is
 * text in a message rather than somewhere the team is standing. Saying "scoped
 * to this worktree" without that would be the pane's one real lie.
 *
 * The second is a correction. This used to enumerate "not the branch" among the
 * things that do not go, and that was false in the plainest way: this pane names
 * the thread's channel after the worktree's branch (`threadChannelName`) and
 * writes the path into its description (`threadChannelDescription`), both on the
 * relay, in a channel every deployed member is in. The enumeration is about the
 * *message* and the branch is not in one — but "what the team is told" is the
 * claim being made, and by that measure the branch was told. So the sentence
 * says where. */
export function scopeSentence(cwd: string): string {
  return `Each message goes to the relay with one line in front of it — ${scopeLine(cwd)} — and nothing else: not the diff, not the plan, not the run's transcript. The branch is not in the message either, but it is in the name of the channel this thread lives in, and this path is in that channel's description, where everyone in it can read them. The team's agents are not started in this directory and may not be able to open it at all; the path is text in your message, and they read whatever they can reach themselves.`;
}

/** Which step refused, which is the whole of what the sentence below says.
 *
 * **`deploy` is not a nicety.** Opening a thread is two acts — a channel is
 * created and its pointer written, then one agent per member is deployed into it
 * — and only the first decides whether there is a thread. A failure in the
 * second used to be reported as "the thread could not be opened", printed
 * *inside the thread that had just been opened*, next to a composer that worked.
 * A sentence contradicted by what is around it teaches the owner to stop reading
 * the sentences. */
export type TeamThreadStep = "open" | "deploy" | "send";

/** What to say before the reason whatever refused gave.
 *
 * Each one names its step rather than saying "an error", and each says where
 * that leaves him — for `send`, that the text is still in the composer, because
 * text being kept is only useful if he knows to look for it rather than retyping
 * it. The words are about the team's *members*: a team has no key and posts
 * nothing (see this file's header), so it is the members that are deployed and
 * the members that could fail to be. */
export function troubleSentence(step: TeamThreadStep): string {
  switch (step) {
    case "open":
      return "the thread could not be opened: ";
    case "deploy":
      return "the thread is open, but its members could not be deployed into it — the channel is there and you can send in it, and nobody may answer: ";
    case "send":
      return "this message did not go and is still in the composer — send it again when you want: ";
  }
}

/** A message as it will be sent, or `null` for one there is no point sending.
 *
 * The scope goes on every message rather than once at the top, because a thread
 * on a relay is read by an agent as a window of recent events — a path stated
 * only in the first message of a conversation is a path most of its turns never
 * see. */
export function composeTeamMessage(cwd: string, body: string): string | null {
  const said = body.trim();
  if (said === "") return null;
  return `${scopeLine(cwd)}\n\n${said}`;
}

/** The scope line off a message that carries one, for rendering a row without
 * repeating the path in every bubble. `null` for a message that has none —
 * which includes every message a team member wrote. */
export function splitScope(content: string): {
  scope: string | null;
  body: string;
} {
  if (!content.startsWith(SCOPE_PREFIX)) return { body: content, scope: null };
  const end = content.indexOf("\n");
  if (end === -1)
    return { body: "", scope: content.slice(SCOPE_PREFIX.length) };
  return {
    body: content.slice(end + 1).replace(/^\n+/, ""),
    scope: content.slice(SCOPE_PREFIX.length, end),
  };
}

/** Characters a channel name is reduced to. Not a relay constraint — the relay
 * canonicalises names and only refuses an empty one — but a name the owner will
 * see in his channel list beside hand-made ones, and one a second worktree must
 * not accidentally collide with. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

/** A short, stable discriminator for a (worktree, team) pair.
 *
 * FNV-1a over the two ids. It is not a security claim and does not need to be:
 * what it buys is that two worktrees on the same branch name in two repos, or
 * one worktree talking to two teams, do not both ask for the same channel
 * name. The pointer store is what actually finds a thread again — this only
 * keeps the *label* honest. */
function discriminator(bindingId: string, teamId: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${bindingId} ${teamId}`) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, "0").slice(-6);
}

/** What the thread's channel is called. Prefixed so a channel list sorted by
 * name keeps every worktree thread together, and so the owner can tell at a
 * glance which channels this pane made. */
export function threadChannelName(
  bindingId: string,
  teamId: string,
  teamName: string,
  worktreeLabel: string,
): string {
  const parts = [slug(worktreeLabel), slug(teamName)].filter(
    (part) => part !== "",
  );
  const stem = parts.length > 0 ? parts.join("-") : "thread";
  return `wt-${stem}-${discriminator(bindingId, teamId)}`;
}

/** Whether a channel in the owner's list is the one this pane would have made
 * for this (worktree, team) pair.
 *
 * Matched on the discriminator rather than the whole name, because the name
 * also carries the team's and the worktree's labels and either can be renamed
 * after the thread exists — a rename must not make the thread unfindable. The
 * `wt-` prefix keeps a hand-made channel that happens to end in six of the same
 * characters out of it.
 *
 * **This is a recovery path, not the authority.** The pointer store is what
 * normally finds a thread; this is how a *lost* pointer is picked back up
 * without minting a second team, and its only consumer puts the channel's name
 * in front of the owner before adopting it, so a hash collision is something he
 * can see rather than something that happens to him. */
export function isThreadChannelName(
  name: string,
  bindingId: string,
  teamId: string,
): boolean {
  return (
    name.startsWith("wt-") &&
    name.endsWith(`-${discriminator(bindingId, teamId)}`)
  );
}

/** The thread this worktree already has with this team, if the relay still has
 * it. `null` is "not in the list", which after a successful list means there is
 * none to reopen. */
export function findThreadChannel<T extends { id: string; name: string }>(
  channels: readonly T[],
  bindingId: string,
  teamId: string,
): T | null {
  return (
    channels.find((channel) =>
      isThreadChannelName(channel.name, bindingId, teamId),
    ) ?? null
  );
}

/** What the channel says it is for, on the relay, where the owner will read it
 * from the ordinary channel list months later with this pane nowhere in sight. */
export function threadChannelDescription(
  teamName: string,
  cwd: string,
): string {
  return `Worktree thread with ${teamName} about ${cwd}. Opened from the Vingilot workspace; its members post under their own pubkeys.`;
}
