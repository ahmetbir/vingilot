import assert from "node:assert/strict";
import { test } from "node:test";

import { noProbes } from "./paneModel.ts";
import {
  canSend,
  composeTeamMessage,
  findThreadChannel,
  isThreadChannelName,
  NO_COMMUNITY,
  NO_TEAMS,
  RELAY_UNKNOWN,
  RELAY_UNREACHABLE,
  readTeamThread,
  relayReach,
  SCOPE_PREFIX,
  scopeLine,
  scopeSentence,
  splitScope,
  TEAMS_ASKING,
  TEAMS_UNKNOWN,
  teamAvailability,
  threadChannelDescription,
  threadChannelName,
} from "./teamThread.ts";

const READY = { community: true, relay: "reachable", teams: 2 };

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

test("the scope line is the prefix and the path, and nothing else", () => {
  assert.equal(scopeLine("/tmp/vingilot-left"), "worktree: /tmp/vingilot-left");
  assert.equal(scopeLine("/x").startsWith(SCOPE_PREFIX), true);
});

test("the sentence quotes the line it will actually send", () => {
  const sentence = scopeSentence("/tmp/vingilot-left");
  assert.ok(sentence.includes(scopeLine("/tmp/vingilot-left")));
  // And it enumerates what does not go, ask-mode's rule.
  assert.match(sentence, /not the diff/);
  assert.match(sentence, /not the branch/);
  assert.match(sentence, /not the plan/);
  // Plus the one thing ask-mode does not have to say.
  assert.match(sentence, /not started in this directory/);
});

test("a composed message carries the scope line and the words, in that order", () => {
  assert.equal(
    composeTeamMessage("/tmp/wt", "  why is the build red  "),
    "worktree: /tmp/wt\n\nwhy is the build red",
  );
});

test("an empty message is not a message", () => {
  assert.equal(composeTeamMessage("/tmp/wt", ""), null);
  assert.equal(composeTeamMessage("/tmp/wt", "   \n  "), null);
});

test("the scope comes back off a message it was put on", () => {
  const sent = composeTeamMessage("/tmp/wt", "why is the build red");
  assert.deepEqual(splitScope(sent), {
    body: "why is the build red",
    scope: "/tmp/wt",
  });
});

test("a message nobody scoped keeps every character it had", () => {
  // What a team member wrote. Reading a scope off it would be inventing one.
  assert.deepEqual(splitScope("the lockfile is stale"), {
    body: "the lockfile is stale",
    scope: null,
  });
});

// --- the channel this all lands in -----------------------------------------

test("a thread channel is named for its worktree and its team", () => {
  const name = threadChannelName(
    "binding-1",
    "team-launch",
    "Launch Team",
    "feat/parser",
  );
  assert.match(name, /^wt-feat-parser-launch-team-[a-z0-9]{6}$/);
});

test("two worktrees on the same branch do not ask for the same channel", () => {
  const a = threadChannelName("binding-1", "team-1", "Team", "main");
  const b = threadChannelName("binding-2", "team-1", "Team", "main");
  assert.notEqual(a, b);
});

test("one worktree talking to two teams does not ask for the same channel", () => {
  const a = threadChannelName("binding-1", "team-1", "Alpha", "main");
  const b = threadChannelName("binding-1", "team-2", "Alpha", "main");
  assert.notEqual(a, b);
});

test("the same pair asks for the same name every time", () => {
  const args = ["binding-1", "team-1", "Alpha", "main"];
  assert.equal(threadChannelName(...args), threadChannelName(...args));
});

test("a team and a branch with nothing nameable in them still make a name", () => {
  const name = threadChannelName("binding-1", "team-1", "///", "!!!");
  assert.match(name, /^wt-thread-[a-z0-9]{6}$/);
});

test("the channel's description says where it came from and who signs it", () => {
  const described = threadChannelDescription("Launch Team", "/tmp/wt");
  assert.match(described, /Launch Team/);
  assert.match(described, /\/tmp\/wt/);
  assert.match(described, /own pubkeys/);
});

// ── Finding an existing thread rather than deploying a second team ──────────
// The pointer is the authority; this is the recovery path for when it is gone,
// and the only thing standing between a dropped pointer and a duplicate agent
// process per team member.

test("the thread this worktree already has is found by name", () => {
  const name = threadChannelName("binding-1", "team-1", "Launch Team", "main");
  const channels = [
    { id: "chan-other", name: "general" },
    { id: "chan-thread", name },
  ];
  assert.equal(
    findThreadChannel(channels, "binding-1", "team-1")?.id,
    "chan-thread",
  );
});

test("renaming the team or the branch does not lose the thread", () => {
  // The name carries both labels, and both can be edited after the thread
  // exists. What identifies it is the (worktree, team) pair.
  const name = threadChannelName("binding-1", "team-1", "Launch Team", "main");
  const renamed = name.replace("launch-team", "shipping-team");
  assert.notEqual(renamed, name);
  assert.equal(isThreadChannelName(renamed, "binding-1", "team-1"), true);
});

test("another worktree's thread with the same team is not this one", () => {
  const name = threadChannelName("binding-2", "team-1", "Launch Team", "main");
  assert.equal(isThreadChannelName(name, "binding-1", "team-1"), false);
  assert.equal(
    findThreadChannel([{ id: "c", name }], "binding-1", "team-1"),
    null,
  );
});

test("this worktree's thread with another team is not this one", () => {
  const name = threadChannelName("binding-1", "team-2", "Launch Team", "main");
  assert.equal(isThreadChannelName(name, "binding-1", "team-1"), false);
});

test("a hand-made channel is never mistaken for a thread this pane opened", () => {
  const name = threadChannelName("binding-1", "team-1", "Launch Team", "main");
  const suffix = name.slice(name.lastIndexOf("-"));
  // Same trailing discriminator, no `wt-` prefix: not something this pane made,
  // so adopting it would point the pane at someone else's channel.
  assert.equal(
    isThreadChannelName(`design${suffix}`, "binding-1", "team-1"),
    false,
  );
});

test("no thread on the relay reads as none, and never as a throw", () => {
  assert.equal(findThreadChannel([], "binding-1", "team-1"), null);
});
