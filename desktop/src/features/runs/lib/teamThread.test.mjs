import assert from "node:assert/strict";
import { test } from "node:test";

import { noProbes } from "./paneModel.ts";
import * as teamThread from "./teamThread.ts";
import {
  availableChannelName,
  canSend,
  findThreadChannel,
  hasLegacyThreadChannelShape,
  isLegacyThreadChannelName,
  isThreadChannelDescription,
  NO_COMMUNITY,
  NO_TEAMS,
  RELAY_UNKNOWN,
  RELAY_UNREACHABLE,
  readTeamThread,
  relayReach,
  scopeSentence,
  TEAMS_ASKING,
  TEAMS_UNKNOWN,
  teamAvailability,
  threadChannelDescription,
  threadChannelMarker,
  threadChannelName,
  threadChannelRepair,
  troubleSentence,
} from "./teamThread.ts";

const READY = { community: true, relay: "reachable", teams: 2 };

/** The six characters an older build put on the end of this pair's channel
 * name. The discriminator itself is not exported — nothing outside that file
 * should be minting one — so it is read back off the one exported path that
 * still emits it: a name that had to be discriminated because it was taken. */
function probeDiscriminator(bindingId, teamId) {
  return availableChannelName("x", ["x"], bindingId, teamId).slice("x-".length);
}

function facts(overrides) {
  return { ...READY, ...overrides };
}

function ctx(overrides) {
  return {
    cwd: "/tmp/wt",
    cwdPending: false,
    ownerRunId: null,
    probe: noProbes(),
    projectPath: "/tmp/repo",
    worktreeId: "binding-1",
    ...overrides,
  };
}

// --- the reading -----------------------------------------------------------

test("everything answered and in place reads ready", () => {
  assert.deepEqual(readTeamThread(facts({})), { status: "ready" });
});

test("no community is its own sentence, and it names why the relay matters", () => {
  const reading = readTeamThread(facts({ community: false }));
  assert.equal(reading.status, "blocked");
  assert.equal(reading.reason, NO_COMMUNITY);
  assert.match(reading.reason, /relay/);
});

test("no teams configured is its own sentence, and it says where teams are made", () => {
  const reading = readTeamThread(facts({ teams: 0 }));
  assert.equal(reading.status, "blocked");
  assert.equal(reading.reason, NO_TEAMS);
  assert.match(reading.reason, /Agents → Teams/);
});

test("an unreachable relay is its own sentence, distinct from the other two", () => {
  const reading = readTeamThread(facts({ relay: "unreachable" }));
  assert.equal(reading.status, "blocked");
  assert.equal(reading.reason, RELAY_UNREACHABLE);
  assert.notEqual(reading.reason, NO_TEAMS);
  assert.notEqual(reading.reason, NO_COMMUNITY);
});

test("the unreachable sentence describes a pane with nothing to type into", () => {
  // `canSend` is false here, and the pane renders no composer and no thread at
  // all on a blocked reading — so a sentence about what "nothing typed here"
  // would do was about a box that is not on screen, and said nothing about the
  // conversation having gone with it.
  assert.equal(canSend(readTeamThread(facts({ relay: "unreachable" }))), false);
  assert.doesNotMatch(RELAY_UNREACHABLE, /nothing typed here/);
  assert.match(RELAY_UNREACHABLE, /neither show the thread nor take a message/);
  // And it says what survives the wait, which is the owner's actual question.
  assert.match(RELAY_UNREACHABLE, /half-written here is kept/);
});

test("a team list that could not be asked is never rendered as none", () => {
  const reading = readTeamThread(facts({ teams: "unknown" }));
  assert.equal(reading.status, "unsure");
  assert.equal(reading.note, TEAMS_UNKNOWN);
  assert.notEqual(reading.note, NO_TEAMS);
  // And the pane stays usable: not being told is not being refused.
  assert.equal(canSend(reading), true);
});

test("a relay that could not be asked about is never rendered as unreachable", () => {
  const reading = readTeamThread(facts({ relay: "unknown" }));
  assert.equal(reading.status, "unsure");
  assert.equal(reading.note, RELAY_UNKNOWN);
  assert.notEqual(reading.note, RELAY_UNREACHABLE);
  assert.equal(canSend(reading), true);
});

test("still asking is a wait, and a wait does not take a message", () => {
  const reading = readTeamThread(facts({ teams: "asking" }));
  assert.equal(reading.status, "waiting");
  assert.equal(reading.note, TEAMS_ASKING);
  assert.equal(canSend(reading), false);
});

test("a structural blocker is reported before a transient one", () => {
  // Both true at once. The owner's next move is to make a team, not to wait
  // for a socket, so the sentence has to be the one he can act on.
  const reading = readTeamThread(facts({ relay: "unreachable", teams: 0 }));
  assert.equal(reading.reason, NO_TEAMS);
});

test("no community outranks every other answer", () => {
  const reading = readTeamThread(
    facts({ community: false, relay: "unreachable", teams: "unknown" }),
  );
  assert.equal(reading.reason, NO_COMMUNITY);
});

test("a blocked reading never takes a message", () => {
  for (const overrides of [
    { community: false },
    { teams: 0 },
    { relay: "unreachable" },
  ]) {
    assert.equal(canSend(readTeamThread(facts(overrides))), false);
  }
});

test("a socket nobody has opened is a question unasked, not a relay that said no", () => {
  // The workspace screen reaches the relay through Tauri commands and only
  // opens a socket once a thread subscribes, so `idle` is where this pane
  // finds it most of the time.
  assert.equal(relayReach("idle"), "unknown");
  assert.equal(canSend(readTeamThread(facts({ relay: "unknown" }))), true);
});

test("the socket's other states each map to one answer", () => {
  assert.equal(relayReach("connected"), "reachable");
  assert.equal(relayReach("connecting"), "asking");
  assert.equal(relayReach("reconnecting"), "asking");
  assert.equal(relayReach("stalled"), "unreachable");
  assert.equal(relayReach("disconnected"), "unreachable");
});

// --- availability ----------------------------------------------------------

test("a worktree with a directory can hold a team thread", () => {
  assert.deepEqual(teamAvailability(ctx({})), { status: "available" });
});

test("a checkout still resolving is pending, not a refusal", () => {
  const availability = teamAvailability(ctx({ cwd: null, cwdPending: true }));
  assert.equal(availability.status, "pending");
});

test("a worktree with no nameable directory says there is nothing to be about", () => {
  const availability = teamAvailability(ctx({ cwd: null, cwdPending: false }));
  assert.equal(availability.status, "unavailable");
  assert.match(availability.reason, /nothing to tell a team/);
});

// --- the scope, which is the thing the browser spec checks against ---------

test("the sentence names the worktree and enumerates what does not go", () => {
  const sentence = scopeSentence("/tmp/vingilot-left");
  assert.ok(sentence.includes("/tmp/vingilot-left"));
  // Ask-mode's rule: state the context, then enumerate what is not sent.
  assert.match(sentence, /not the diff/);
  assert.match(sentence, /not the plan/);
  // Plus the one thing ask-mode does not have to say.
  assert.match(sentence, /not started in this directory/);
});

test("the sentence claims nothing is put in front of a message, and nothing can put it there", () => {
  // The pane hosts upstream's composer, which sends what was typed. A sentence
  // still promising a `worktree: …` line in front of every message would be
  // describing a send path that no longer exists — and the way that promise
  // came back would be a helper here quietly composing one again. Both halves
  // are asserted: the claim, and the absence of anything able to make it true.
  const sentence = scopeSentence("/tmp/vingilot-left");
  assert.match(sentence, /what you type is what is sent/);
  assert.doesNotMatch(sentence, /in front of it/);
  assert.equal(teamThread.composeTeamMessage, undefined);
  assert.equal(teamThread.splitScope, undefined);
  assert.equal(teamThread.scopeLine, undefined);
  assert.equal(teamThread.SCOPE_PREFIX, undefined);
});

test("the sentence does not claim the branch is kept from the team", () => {
  // It used to enumerate "not the branch" among the things that do not go —
  // while this pane names the thread's channel after the branch and writes the
  // path into its description, both on the relay and both readable by every
  // member deployed into it. Whatever is true of the message body, that is not
  // a worktree kept to oneself, so the claim goes and the channel is named.
  const sentence = scopeSentence("/tmp/vingilot-left");
  assert.doesNotMatch(sentence, /not the branch,/);
  assert.match(sentence, /name of the channel/);
  assert.match(sentence, /this channel's description/);
  // The channel really is named after the branch — the fact the sentence is
  // answering to, asserted here rather than assumed.
  assert.match(
    threadChannelName("Launch Team", "/src/talon", "feat/parser"),
    /feat-parser/,
  );
});

// --- what refused, and where that leaves him -------------------------------

test("a failed deploy never says the thread could not be opened", () => {
  // The channel is created and its pointer written *before* the members are
  // deployed, so a failure in the second half happens with the thread open and
  // this sentence printed inside it. "Could not be opened" there is contradicted
  // by everything around it.
  const deploy = troubleSentence("deploy");
  assert.doesNotMatch(deploy, /could not be opened/);
  assert.match(deploy, /the thread is open/);
  assert.match(deploy, /you can send in it/);
  // And it says the consequence, which is the part he would otherwise find out
  // by waiting for an answer that is not coming.
  assert.match(deploy, /nobody may answer/);
});

test("the two steps never read as each other, and neither claims a send", () => {
  const [open, deploy] = ["open", "deploy"].map(troubleSentence);
  assert.equal(new Set([open, deploy]).size, 2);
  assert.match(open, /could not be opened/);
  // A message that does not leave is reported by the composer that took it —
  // upstream's, in the words every other channel uses. This island reporting a
  // failed send would be reporting a send it no longer makes.
  assert.equal(troubleSentence("send"), undefined);
});

test("a rename that refused says the thread is untouched, and what it cost", () => {
  // The failure is invisible on screen — the thread works, the words are all
  // there — and its whole cost is later: a channel still called `wt-…` that a
  // lost pointer would have to be matched to by hand.
  const rename = troubleSentence("rename");
  assert.match(rename, /the thread is open/);
  assert.match(rename, /everything in it is where it was/);
  assert.match(rename, /lost its pointer/);
  assert.doesNotMatch(rename, /could not be opened/);
  assert.equal(
    new Set(["open", "deploy", "rename"].map(troubleSentence)).size,
    3,
  );
});

test("every step's sentence is about the members, never about the team", () => {
  // A team holds no key and posts nothing; what is deployed, and what can fail
  // to be, is one agent per member (`teamThread.ts`'s header).
  for (const step of ["open", "deploy"]) {
    assert.doesNotMatch(troubleSentence(step), /the team could not/);
  }
  assert.match(troubleSentence("deploy"), /its members could not be deployed/);
});

// --- the channel this all lands in -----------------------------------------
// The owner read `#wt-main-welcome-team-kbz5pz` in his sidebar and asked what
// `wt-main` was. These say what he gets instead, and — the half that is easy to
// get wrong quietly — that the name carries no machinery any more.

test("a thread channel is named team, then project, then branch", () => {
  const name = threadChannelName("Launch Team", "/src/talon", "feat/parser");
  assert.equal(name, "launch-team-talon-feat-parser");
});

test("a name in the clear has no hash on it and no prefix in front of it", () => {
  // The two things the old name carried that a human would not have written.
  const name = threadChannelName("Welcome Team", "/src/talon", "main");
  assert.equal(name, "welcome-team-talon-main");
  assert.doesNotMatch(name, /^wt-/);
  assert.doesNotMatch(name, /-[a-z0-9]{6}$/);
});

test("a project this app cannot name drops that part rather than emptying it", () => {
  assert.equal(
    threadChannelName("Launch Team", null, "main"),
    "launch-team-main",
  );
  assert.equal(
    threadChannelName("Launch Team", "/", "main"),
    "launch-team-main",
  );
});

test("a team and a branch with nothing nameable in them still make a name", () => {
  assert.equal(threadChannelName("///", null, "!!!"), "team-thread");
});

test("the same worktree and team ask for the same name every time", () => {
  const args = ["Alpha", "/src/talon", "main"];
  assert.equal(threadChannelName(...args), threadChannelName(...args));
});

// ── The hash, bought at the moment it is needed and not before ──────────────

test("a free name is taken as it is, which is the ordinary case", () => {
  const wanted = threadChannelName("Welcome Team", "/src/talon", "main");
  assert.equal(
    availableChannelName(wanted, ["general", "random"], "binding-1", "team-1"),
    "welcome-team-talon-main",
  );
});

test("a name already in his sidebar is the only thing that buys a discriminator", () => {
  const wanted = threadChannelName("Welcome Team", "/src/talon", "main");
  const taken = availableChannelName(
    wanted,
    ["general", wanted],
    "binding-1",
    "team-1",
  );
  assert.match(taken, /^welcome-team-talon-main-[a-z0-9]{6}$/);
  // And it is a *different* worktree's discriminator that would be appended for
  // a different worktree — the suffix identifies the pair asking for the name.
  assert.notEqual(
    taken,
    availableChannelName(wanted, ["general", wanted], "binding-2", "team-1"),
  );
});

test("a collision is judged the way the relay and the eye would judge it", () => {
  // `canonical_channel_name` strips a leading `#` and trims; case it leaves
  // alone, and there is no unique index on the name at all — so `#Welcome-Team-
  // Talon-Main ` is a second row on the relay and one channel to the owner.
  const wanted = threadChannelName("Welcome Team", "/src/talon", "main");
  assert.notEqual(
    availableChannelName(
      wanted,
      ["#Welcome-Team-Talon-Main "],
      "binding-1",
      "team-1",
    ),
    wanted,
  );
});

test("a second thread with the same team gets a name of its own", () => {
  // The one case the discriminator cannot separate: it is a function of the
  // pair, and this is the same pair twice (`Preflight` asks before it happens).
  const wanted = threadChannelName("Welcome Team", "/src/talon", "main");
  const first = availableChannelName(wanted, [wanted], "binding-1", "team-1");
  const second = availableChannelName(
    wanted,
    [wanted, first],
    "binding-1",
    "team-1",
  );
  assert.notEqual(second, first);
  assert.notEqual(second, wanted);
});

// ── What says whose thread a channel is, now that the name does not ─────────

test("the channel's description says where it came from and who signs it", () => {
  const described = threadChannelDescription(
    "Launch Team",
    "/tmp/wt",
    "binding-1",
    "team-1",
  );
  assert.match(described, /Launch Team/);
  assert.match(described, /\/tmp\/wt/);
  assert.match(described, /own pubkeys/);
});

test("the description carries the mark the name used to, and it names both ids", () => {
  const described = threadChannelDescription(
    "Launch Team",
    "/tmp/wt",
    "binding-1",
    "team-1",
  );
  assert.ok(described.includes(threadChannelMarker("binding-1", "team-1")));
  assert.equal(
    isThreadChannelDescription(described, "binding-1", "team-1"),
    true,
  );
  // Exact pair, so no near miss adopts someone else's thread.
  assert.equal(
    isThreadChannelDescription(described, "binding-2", "team-1"),
    false,
  );
  assert.equal(
    isThreadChannelDescription(described, "binding-1", "team-2"),
    false,
  );
});

// ── Finding an existing thread rather than deploying a second team ──────────
// The pointer is the authority; this is the recovery path for when it is gone,
// and the only thing standing between a dropped pointer and a duplicate agent
// process per team member. **This is the half a human name would have killed
// in silence**, so it is matched on the description and not on the name.

test("the thread this worktree already has is found by its mark", () => {
  const channels = [
    { description: "Where we talk.", id: "chan-other", name: "general" },
    {
      description: threadChannelDescription(
        "Launch Team",
        "/tmp/wt",
        "binding-1",
        "team-1",
      ),
      id: "chan-thread",
      name: "launch-team-talon-main",
    },
  ];
  assert.equal(
    findThreadChannel(channels, "binding-1", "team-1")?.id,
    "chan-thread",
  );
});

test("renaming the channel to anything at all does not lose the thread", () => {
  // The whole trap of this task in one assertion: the name is now the owner's
  // to change, and nothing about finding the thread may depend on it.
  const description = threadChannelDescription(
    "Launch Team",
    "/tmp/wt",
    "binding-1",
    "team-1",
  );
  const channels = [
    { description, id: "chan-thread", name: "the-parser-rewrite" },
  ];
  assert.equal(
    findThreadChannel(channels, "binding-1", "team-1")?.id,
    "chan-thread",
  );
});

test("a thread an older build opened is still found by its old name", () => {
  // On his relay right now, with no mark in its description until this pane
  // repairs it. Dropping this case would strand it.
  const legacy = `wt-main-launch-team-${probeDiscriminator("binding-1", "team-1")}`;
  assert.equal(isLegacyThreadChannelName(legacy, "binding-1", "team-1"), true);
  assert.equal(
    findThreadChannel(
      [{ description: "Worktree thread.", id: "chan-old", name: legacy }],
      "binding-1",
      "team-1",
    )?.id,
    "chan-old",
  );
});

test("another worktree's thread with the same team is not this one", () => {
  const description = threadChannelDescription(
    "Launch Team",
    "/tmp/wt",
    "binding-2",
    "team-1",
  );
  assert.equal(
    findThreadChannel(
      [{ description, id: "c", name: "launch-team-talon-main" }],
      "binding-1",
      "team-1",
    ),
    null,
  );
});

test("this worktree's thread with another team is not this one", () => {
  const description = threadChannelDescription(
    "Launch Team",
    "/tmp/wt",
    "binding-1",
    "team-2",
  );
  assert.equal(
    isThreadChannelDescription(description, "binding-1", "team-1"),
    false,
  );
});

test("a hand-made channel is never mistaken for a thread this pane opened", () => {
  const suffix = probeDiscriminator("binding-1", "team-1");
  // Same trailing discriminator, no `wt-` prefix: not something this pane made,
  // so adopting it would point the pane at someone else's channel.
  assert.equal(
    isLegacyThreadChannelName(`design-${suffix}`, "binding-1", "team-1"),
    false,
  );
  assert.equal(
    findThreadChannel(
      [{ description: "Ours.", id: "c", name: `design-${suffix}` }],
      "binding-1",
      "team-1",
    ),
    null,
  );
});

test("no thread on the relay reads as none, and never as a throw", () => {
  assert.equal(findThreadChannel([], "binding-1", "team-1"), null);
  // A channel list from a build that stored no description reads as unmarked,
  // not as a crash inside the render that puts the workspace up.
  assert.equal(
    findThreadChannel([{ id: "c", name: "general" }], "b", "t"),
    null,
  );
});

// ── The one channel this pane edits without being asked ────────────────────

test("a thread from an older build is given a name and a mark, in one edit", () => {
  const name = `wt-main-launch-team-${probeDiscriminator("binding-1", "team-1")}`;
  const repair = threadChannelRepair({
    bindingId: "binding-1",
    channel: { description: "Worktree thread with Launch Team.", name },
    cwd: "/src/talon",
    otherNames: ["general"],
    projectPath: "/src/talon",
    teamId: "team-1",
    teamName: "Launch Team",
    worktreeLabel: "main",
  });
  assert.equal(repair.name, "launch-team-talon-main");
  assert.equal(
    isThreadChannelDescription(repair.description, "binding-1", "team-1"),
    true,
  );
  // Appended, not replaced: what was in there may be something he typed.
  assert.match(repair.description, /^Worktree thread with Launch Team\./);
});

test("a thread this build opened is left alone", () => {
  // The quiet failure this guards: a repair that fired every render would edit
  // his sidebar forever and publish a kind:9002 each time.
  assert.equal(
    threadChannelRepair({
      bindingId: "binding-1",
      channel: {
        description: threadChannelDescription(
          "Launch Team",
          "/src/talon",
          "binding-1",
          "team-1",
        ),
        name: "launch-team-talon-main",
      },
      cwd: "/src/talon",
      otherNames: [],
      projectPath: "/src/talon",
      teamId: "team-1",
      teamName: "Launch Team",
      worktreeLabel: "main",
    }),
    null,
  );
});

test("a channel the owner named himself keeps his name and only gains the mark", () => {
  const repair = threadChannelRepair({
    bindingId: "binding-1",
    channel: { description: "the parser rewrite", name: "the-parser-rewrite" },
    cwd: "/src/talon",
    otherNames: [],
    projectPath: "/src/talon",
    teamId: "team-1",
    teamName: "Launch Team",
    worktreeLabel: "main",
  });
  assert.equal(repair.name, undefined);
  assert.equal(
    isThreadChannelDescription(repair.description, "binding-1", "team-1"),
    true,
  );
});

test("an empty description is written whole rather than left as a bare mark", () => {
  const repair = threadChannelRepair({
    bindingId: "binding-1",
    channel: { description: "", name: "the-parser-rewrite" },
    cwd: "/src/talon",
    otherNames: [],
    projectPath: "/src/talon",
    teamId: "team-1",
    teamName: "Launch Team",
    worktreeLabel: "main",
  });
  assert.match(repair.description, /Launch Team/);
  assert.match(repair.description, /\/src\/talon/);
});

test("the repaired name avoids what is already in his channel list", () => {
  const name = `wt-main-launch-team-${probeDiscriminator("binding-1", "team-1")}`;
  const repair = threadChannelRepair({
    bindingId: "binding-1",
    channel: { description: "", name },
    cwd: "/src/talon",
    otherNames: ["launch-team-talon-main"],
    projectPath: "/src/talon",
    teamId: "team-1",
    teamName: "Launch Team",
    worktreeLabel: "main",
  });
  assert.notEqual(repair.name, "launch-team-talon-main");
  assert.match(repair.name, /^launch-team-talon-main-[a-z0-9]{6}$/);
});

test("the repair reads a name's shape, never which pair it was for", () => {
  // It is only ever applied to the channel the pointer already names, so the
  // pair is settled before this is asked — and asking again would strand a
  // channel whose ids the discriminator no longer matches.
  assert.equal(
    hasLegacyThreadChannelShape("wt-main-welcome-team-kbz5pz"),
    true,
  );
  assert.equal(hasLegacyThreadChannelShape("welcome-team-talon-main"), false);
  assert.equal(hasLegacyThreadChannelShape("the-parser-rewrite"), false);
});
