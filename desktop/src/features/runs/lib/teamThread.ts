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
// Pure: the sentences, the reading, and what the thread's channel is called.
// Nothing here composes a message any more — the pane hosts upstream's composer
// and what the owner types is what is sent (`scopeSentence`). Every
// question below is asked live by the pane rather than by a `PaneProbe`,
// because a probe is asked once and all four of these change while the owner is
// looking at them — a relay drops, a team is added in another window.

import type { ConnectionState } from "@/shared/api/relayClientShared";

import type { PaneAvailability, PaneContext } from "./paneModel.ts";

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

/** What the pane prints above the hosted conversation. Ask-mode's rule: state
 * the context the team is given, then enumerate what is not — and here, two
 * things more that ask-mode does not have to say.
 *
 * The first: a managed agent is spawned once in `~/.buzz` (or `$HOME`) and
 * never in a per-message directory (`managed_agents/mod.rs`), so the path is
 * text the team reads rather than somewhere it is standing. Saying "scoped to
 * this worktree" without that would be the pane's one real lie.
 *
 * The second is that the worktree is told once, in the channel, rather than on
 * every message. **This sentence changed with the surface.** The pane used to
 * own its composer and prepend `worktree: <cwd>` to every message; it now hosts
 * upstream's composer, which sends what the owner typed and nothing else. There
 * is no honest way to keep the prefix from here — a wrapper that rewrote his
 * message would put a line he did not type into the timeline he is reading, on
 * a surface whose whole point is being the same one as everywhere else. So the
 * scope lives where it already lived too: the path in the channel's description
 * (`threadChannelDescription`), the branch in the channel's name
 * (`threadChannelName`), both on the relay and readable by every member.
 *
 * What that costs, stated rather than hidden: an agent reading the channel as a
 * window of recent events sees the path only if it reads the channel's
 * metadata. A thread whose members need the path in the words has to be told it
 * in a message, by hand, like any other fact. */
export function scopeSentence(cwd: string): string {
  return `This thread is about ${cwd}. The path is in this channel's description and the branch is in the name of the channel it lives in, both on the relay where every member can read them — neither is put in front of your messages: what you type is what is sent, and nothing else goes with it, not the diff, not the plan, not the run's transcript. The team's agents are not started in this directory and may not be able to open it at all; the path is text they are given, and they read whatever they can reach themselves.`;
}

/** Which step refused, which is the whole of what the sentence below says.
 *
 * **`deploy` is not a nicety.** Opening a thread is two acts — a channel is
 * created and its pointer written, then one agent per member is deployed into it
 * — and only the first decides whether there is a thread. A failure in the
 * second used to be reported as "the thread could not be opened", printed
 * *inside the thread that had just been opened*, next to a composer that worked.
 * A sentence contradicted by what is around it teaches the owner to stop reading
 * the sentences.
 *
 * **There is no `send` step any more.** The pane hosts upstream's composer, so a
 * message that does not leave is reported by the composer that took it, in the
 * words and the place every other channel uses. A second sentence for it here
 * would be this island claiming a failure it no longer sees.
 *
 * **`rename` is the one edit this pane makes to a channel it did not just
 * create** (`threadChannelRepair`), and it is reported for the same reason the
 * other two are: it is done on his behalf, without being asked for, to a thing
 * he can see in his sidebar. */
export type TeamThreadStep = "open" | "deploy" | "rename";

/** What to say before the reason whatever refused gave.
 *
 * Each one names its step rather than saying "an error", and each says where
 * that leaves him. The words are about the team's *members*: a team has no key
 * and posts nothing (see this file's header), so it is the members that are
 * deployed and the members that could fail to be. */
export function troubleSentence(step: TeamThreadStep): string {
  switch (step) {
    case "open":
      return "the thread could not be opened: ";
    case "deploy":
      return "the thread is open, but its members could not be deployed into it — the channel is there and you can send in it, and nobody may answer: ";
    case "rename":
      return "the thread is open and everything in it is where it was; its channel could not be given a name a human would give it, nor told which worktree it belongs to, so it keeps the name an older build made up and would have to be found by hand if this worktree ever lost its pointer to it: ";
  }
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

/** The last segment of a path — what a human calls the project. A `null` path
 * and a path with nothing but separators in it are both no label, and the name
 * goes without that part rather than carrying an empty one. */
function projectLabel(projectPath: string | null): string {
  if (projectPath === null) return "";
  const segments = projectPath.split("/").filter((part) => part !== "");
  return segments[segments.length - 1] ?? "";
}

/** A name as the relay stores it, lowercased.
 *
 * `canonical_channel_name` (`crates/buzz-core/src/channel.rs`) strips leading
 * `#` and whitespace and trims the end, so two names differing only there are
 * one name once they land. Case is not the relay's business — it stores what it
 * is given, and there is no unique index on the name at all
 * (`migrations/0001_initial_schema.sql` indexes `(community, nip29_group_id)`
 * and the DM participant hash, and nothing else) — but `Design` and `design`
 * are one channel to the eye reading the sidebar, and the eye is who the
 * collision check below is for. */
function canonicalName(name: string): string {
  return name
    .replace(/^[#\s]+/, "")
    .trimEnd()
    .toLowerCase();
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

/** What the thread's channel is called: team, then project, then branch.
 *
 * **A name a human would have given it**, which is the whole of this change.
 * The old one was `wt-<branch>-<team>-<hash>` — a prefix so the threads sorted
 * together and a discriminator so two of them could never ask for one name —
 * and the owner read it in his sidebar as `#wt-main-welcome-team-kbz5pz` and
 * asked what `wt-main` was. Neither half was worth that: the sort order is a
 * convenience this pane does not need (it reaches its thread by id), and the
 * discriminator is bought below, at the moment a collision actually exists. */
export function threadChannelName(
  teamName: string,
  projectPath: string | null,
  worktreeLabel: string,
): string {
  const parts = [
    slug(teamName),
    slug(projectLabel(projectPath)),
    slug(worktreeLabel),
  ].filter((part) => part !== "");
  return parts.length > 0 ? parts.join("-") : "team-thread";
}

/** The wanted name, or the nearest free one — the hash, bought honestly.
 *
 * **The relay will not answer this for us.** It enforces no name uniqueness
 * within a community after canonicalisation: nothing in the schema indexes the
 * name, and `buzz-db`'s `create_channel`/`update_channel` only canonicalise it
 * and refuse an empty one. So a collision is not an error to report — it is two
 * identical rows in his sidebar, silently. That makes the check the client's
 * job, against the list he can actually see, with the discriminator appended
 * only when the plain name is taken. */
export function availableChannelName(
  wanted: string,
  taken: readonly string[],
  bindingId: string,
  teamId: string,
): string {
  const used = new Set(taken.map(canonicalName));
  if (!used.has(canonicalName(wanted))) return wanted;
  const discriminated = `${wanted}-${discriminator(bindingId, teamId)}`;
  if (!used.has(canonicalName(discriminated))) return discriminated;
  // Reached only by a *second* thread for the same (worktree, team) pair, which
  // `Preflight` asks about before opening: the discriminator is a function of
  // that pair, so this is the one case where it cannot separate two channels.
  for (let n = 2; n <= used.size + 2; n += 1) {
    const numbered = `${discriminated}-${n}`;
    if (!used.has(canonicalName(numbered))) return numbered;
  }
  // Unreachable: the loop tries more names than there are taken ones.
  return discriminated;
}

/** The mark that says which (worktree, team) pair a channel is the thread of.
 *
 * **In the description, and no longer in the name.** Recovery used to match on
 * the name's shape, so giving the channel a name a human would give it would
 * have disabled recovery without a word — a failure nothing notices until a
 * pointer is actually lost, which is the one moment recovery is all there is.
 *
 * The description is carried on exactly the objects the recovery path reads,
 * which was checked before this was relied on rather than after: `get_channels`
 * builds every row from the kind:39000 metadata event's `about` tag
 * (`nostr_convert::channel_info_from_event`), and `fromRawChannel` copies it
 * onto `Channel.description` — the same list `findThreadChannel` is handed. And
 * a rename does not disturb it: the relay's kind:9002 handler updates only the
 * columns whose tags are present (`handle_edit_metadata`), so a name-only edit
 * leaves `about` exactly where it was.
 *
 * The two ids go in whole rather than hashed. There is room for them here, and
 * an exact pair is an exact answer — no discriminator, so no collision to put
 * in front of the owner before adopting. The one shape this cannot survive is
 * an id containing the marker's own delimiters, which no id in this app has:
 * both are opaque strings minted by the coordinator and the team store. */
export function threadChannelMarker(bindingId: string, teamId: string): string {
  return `[vingilot-thread ${bindingId} ${teamId}]`;
}

/** Whether a channel's description says it is this pair's thread. */
export function isThreadChannelDescription(
  description: string,
  bindingId: string,
  teamId: string,
): boolean {
  return description.includes(threadChannelMarker(bindingId, teamId));
}

/** The name this pane gave a thread before 2026-08-10, for this exact pair.
 *
 * Kept for one reason: channels the old build made are on the owner's relay
 * with no marker in their description, and until each is repaired this is the
 * only thing that can find one. Nothing writes a name of this shape any more.
 *
 * Matched on the discriminator rather than the whole name, because the old name
 * also carried the team's and the worktree's labels and either could be renamed
 * after the thread existed. The `wt-` prefix keeps a hand-made channel that
 * happens to end in six of the same characters out of it. */
export function isLegacyThreadChannelName(
  name: string,
  bindingId: string,
  teamId: string,
): boolean {
  return (
    name.startsWith("wt-") &&
    name.endsWith(`-${discriminator(bindingId, teamId)}`)
  );
}

/** The same shape, without asking which pair it was made for.
 *
 * Only ever applied to a channel the *pointer* has already identified, which is
 * what makes dropping the discriminator safe here: which pair this is was
 * settled before this was asked, and all that is left to answer is "did an
 * older build write this name" — so a channel the owner named himself is left
 * alone rather than renamed out from under him. */
export function hasLegacyThreadChannelShape(name: string): boolean {
  return /^wt-[a-z0-9-]*-[a-z0-9]{6}$/.test(name);
}

/** The thread this worktree already has with this team, if the relay still has
 * it. `null` is "not in the list", which after a successful list means there is
 * none to reopen.
 *
 * **This is a recovery path, not the authority.** The pointer store is what
 * normally finds a thread; this is how a *lost* pointer is picked back up
 * without minting a second team, and its only consumer puts the channel's name
 * in front of the owner before adopting it.
 *
 * The marker is asked first and the old name second, so a repaired channel is
 * matched on the pair itself and only an unrepaired one falls back to a shape. */
export function findThreadChannel<
  T extends { id: string; name: string; description?: string | null },
>(channels: readonly T[], bindingId: string, teamId: string): T | null {
  return (
    channels.find((channel) =>
      isThreadChannelDescription(channel.description ?? "", bindingId, teamId),
    ) ??
    channels.find((channel) =>
      isLegacyThreadChannelName(channel.name, bindingId, teamId),
    ) ??
    null
  );
}

/** What the channel says it is for, on the relay, where the owner will read it
 * from the ordinary channel list months later with this pane nowhere in sight —
 * and, at the end, the marker that says which worktree and team it belongs to. */
export function threadChannelDescription(
  teamName: string,
  cwd: string,
  bindingId: string,
  teamId: string,
): string {
  return `Worktree thread with ${teamName} about ${cwd}. Opened from the Vingilot workspace; its members post under their own pubkeys. ${threadChannelMarker(bindingId, teamId)}`;
}

/** What one channel edit would have to change for a thread opened by an older
 * build to be a thread this one can name and can find again — or `null` when
 * there is nothing to change, which is every channel this build opened.
 *
 * Both halves ride in one `update_channel`, and that is deliberate — one
 * kind:9002 event carrying both tags is one thing to accept or reject. It is
 * not atomic further in: the relay walks the tags and writes one
 * `update_channel` row per tag, `name` before `about`
 * (`buzz-relay/src/handlers/side_effects.rs`, `handle_edit_metadata`), so a
 * failure between the two leaves the channel renamed with no marker — a name
 * `isLegacyThreadChannelName` no longer recognises and no marker to match
 * instead. What saves that case is the workspace pointer: while it survives,
 * the next open finds the channel by id and this repair runs again, this time
 * returning the marker alone.
 *
 * The name is only rewritten when an older build wrote it. A channel the owner
 * renamed himself keeps his name and gets the marker, because the marker is the
 * half that recovery needs and the name is his. */
export interface ThreadChannelRepair {
  name?: string;
  description?: string;
}

export function threadChannelRepair(input: {
  channel: { name: string; description?: string | null };
  /** Every other channel in the owner's list, so a new name can avoid them. */
  otherNames: readonly string[];
  bindingId: string;
  teamId: string;
  teamName: string;
  cwd: string;
  projectPath: string | null;
  worktreeLabel: string;
}): ThreadChannelRepair | null {
  const description = input.channel.description ?? "";
  const marked = isThreadChannelDescription(
    description,
    input.bindingId,
    input.teamId,
  );
  const legacy = hasLegacyThreadChannelShape(input.channel.name);
  if (marked && !legacy) return null;

  const repair: ThreadChannelRepair = {};
  if (!marked) {
    // Appended rather than rewritten: whatever is in there may be something the
    // owner typed, and the marker is the only part this pane needs to be true.
    repair.description =
      description.trim() === ""
        ? threadChannelDescription(
            input.teamName,
            input.cwd,
            input.bindingId,
            input.teamId,
          )
        : `${description.trim()} ${threadChannelMarker(input.bindingId, input.teamId)}`;
  }
  if (legacy) {
    repair.name = availableChannelName(
      threadChannelName(input.teamName, input.projectPath, input.worktreeLabel),
      input.otherNames,
      input.bindingId,
      input.teamId,
    );
  }
  return repair;
}
