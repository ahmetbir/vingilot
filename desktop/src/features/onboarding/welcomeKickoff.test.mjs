import assert from "node:assert/strict";
import test from "node:test";

import {
  areWelcomeTeammatesOnline,
  buildWelcomeKickoffCloser,
  buildWelcomeKickoffOpener,
  buildWelcomeKickoffOpenerSendInput,
  classifyWelcomeKickoffResolution,
  createWelcomeKickoffCoordinator,
  mergeKickoffEvents,
  resolveWelcomeAgentSet,
  selectWelcomeKickoffIntroTeammates,
  waitForWelcomeKickoffBeat,
  waitForWelcomeTeammatesOnline,
  welcomeTeammateNeedsRestart,
} from "./welcomeKickoff.ts";

function agent(name, personaId, pubkey) {
  return {
    name,
    personaId,
    teamId: "builtin-team:crew",
    pubkey,
    relayUrl: "ws://localhost:3000",
    status: "stopped",
    lastError: null,
    lastStartedAt: null,
  };
}

const navigator = agent("Navigator", "builtin:navigator", "f".repeat(64));
const bosun = agent("Bosun", "builtin:bosun", "h".repeat(64));
const lookout = agent("Lookout", "builtin:lookout", "b".repeat(64));
const scribe = agent("Scribe", "builtin:scribe", "5".repeat(64));

test("resolveWelcomeAgentSet orders agents by stable persona identity", () => {
  assert.deepEqual(
    resolveWelcomeAgentSet([lookout, scribe, navigator, bosun]),
    {
      lead: navigator,
      teammates: [bosun, lookout, scribe],
    },
  );
  assert.equal(resolveWelcomeAgentSet([navigator, bosun, lookout]), null);
});

// The bees were the starters before the crew. An install still running Fizz,
// Honey and Bumble resolves to no set at all rather than a partial one — the
// kickoff then provisions the crew instead of half-greeting with the old team.
test("resolveWelcomeAgentSet does not resolve the retired bee team", () => {
  const bees = [
    agent("Fizz", "builtin:fizz", "1".repeat(64)),
    agent("Honey", "builtin:honey", "2".repeat(64)),
    agent("Bumble", "builtin:bumble", "3".repeat(64)),
  ];
  assert.equal(resolveWelcomeAgentSet(bees), null);
});

// Mate is an owner-only DM: even if an instance exists and is bound to the crew
// team, it is not a starter, so it never becomes lead and never becomes a
// teammate the opener mentions.
test("resolveWelcomeAgentSet never picks up Mate", () => {
  const mate = agent("Mate", "builtin:mate", "4".repeat(64));
  const set = resolveWelcomeAgentSet([mate, navigator, bosun, lookout, scribe]);
  assert.equal(set.lead, navigator);
  assert.deepEqual(set.teammates, [bosun, lookout, scribe]);
});

test("opener uses current agent names and requests bounded simultaneous intros", () => {
  const opener = buildWelcomeKickoffOpener({ ...navigator, name: "Skipper" }, [
    { ...bosun, name: "Boats" },
    lookout,
  ]);

  assert.match(opener, /I'm Skipper/);
  assert.match(opener, /@Boats and @Lookout/);
  assert.doesNotMatch(opener, /@@/);
  assert.match(opener, /sentence or two/);
  assert.match(opener, /Don't start any work yet/);
});

test("teammates are not ready until every harness publishes online presence", () => {
  assert.equal(areWelcomeTeammatesOnline([bosun, lookout], undefined), false);
  assert.equal(
    areWelcomeTeammatesOnline([bosun, lookout], {
      [bosun.pubkey]: "online",
      [lookout.pubkey]: "offline",
    }),
    false,
  );
  assert.equal(
    areWelcomeTeammatesOnline([bosun, lookout], {
      [bosun.pubkey]: "online",
      [lookout.pubkey]: "online",
    }),
    true,
  );
});

test("readiness wait observes agents becoming online without navigation", async () => {
  let reads = 0;
  const ready = await waitForWelcomeTeammatesOnline([bosun, lookout], {
    isCancelled: () => false,
    loadPresence: async () => {
      reads += 1;
      return reads < 3
        ? { [bosun.pubkey]: "online", [lookout.pubkey]: "offline" }
        : { [bosun.pubkey]: "online", [lookout.pubkey]: "online" };
    },
    pollMs: 0,
    waitMs: 1_000,
  });

  assert.deepEqual(ready, [bosun, lookout]);
  assert.equal(reads, 3);
});

test("readiness wait retries transient presence failures", async () => {
  let reads = 0;
  const ready = await waitForWelcomeTeammatesOnline([bosun, lookout], {
    isCancelled: () => false,
    loadPresence: async () => {
      reads += 1;
      if (reads === 1) throw new Error("relay unavailable");
      return { [bosun.pubkey]: "online", [lookout.pubkey]: "online" };
    },
    pollMs: 0,
    waitMs: 1_000,
  });

  assert.deepEqual(ready, [bosun, lookout]);
  assert.equal(reads, 2);
});

test("readiness wait cancels when Welcome loses focus", async () => {
  const ready = await waitForWelcomeTeammatesOnline([bosun, lookout], {
    isCancelled: () => true,
    loadPresence: async () => {
      throw new Error("cancelled waits must not query");
    },
    pollMs: 0,
    waitMs: 1_000,
  });

  assert.deepEqual(ready, []);
});

test("kickoff beat waits for the configured pacing interval", async () => {
  const startedAt = Date.now();
  assert.equal(await waitForWelcomeKickoffBeat({ waitMs: 10 }), true);
  assert.ok(Date.now() - startedAt >= 8);
});

test("kickoff beat cancels when Welcome loses focus", async () => {
  const controller = new AbortController();
  const beat = waitForWelcomeKickoffBeat({
    signal: controller.signal,
    waitMs: 1_000,
  });
  controller.abort();
  assert.equal(await beat, false);
});

test("kickoff coordinator preserves one task across rerenders and cancels on navigation", () => {
  const coordinator = createWelcomeKickoffCoordinator();
  const first = coordinator.begin("welcome");
  assert.ok(first);
  assert.equal(coordinator.begin("welcome"), null);
  assert.equal(first.signal.aborted, false);

  coordinator.cancel("welcome");
  assert.equal(first.signal.aborted, true);
  assert.ok(coordinator.begin("welcome"));
});

test("closer degrades coherently for partial and total startup failure", () => {
  assert.match(buildWelcomeKickoffCloser([]), /What can we help you build/);
  assert.match(buildWelcomeKickoffCloser(["Bosun"]), /Bosun is having trouble/);
  assert.match(
    buildWelcomeKickoffCloser(["Bosun", "Lookout"]),
    /Bosun and Lookout couldn't start/,
  );
  assert.match(
    buildWelcomeKickoffCloser(["Bosun", "Lookout"]),
    /I'm still here to help/,
  );
});

test("closer names teammates that did not reply before the intro wait", () => {
  assert.match(
    buildWelcomeKickoffCloser([], ["Lookout"]),
    /Lookout is taking longer to reply/,
  );
  assert.match(
    buildWelcomeKickoffCloser(["Bosun"], ["Lookout"]),
    /Bosun and Lookout are taking longer than expected/,
  );
});

test("running teammates restart when their allowlist does not include the lead", () => {
  assert.equal(
    welcomeTeammateNeedsRestart(
      {
        ...bosun,
        status: "running",
        respondTo: "allowlist",
        respondToAllowlist: [navigator.pubkey],
      },
      navigator.pubkey,
    ),
    false,
  );
  assert.equal(
    welcomeTeammateNeedsRestart(
      {
        ...lookout,
        status: "running",
        respondTo: "allowlist",
        respondToAllowlist: [bosun.pubkey],
      },
      navigator.pubkey,
    ),
    true,
  );
});

test("owner-only-access policy does not restart running local and provider teammates", () => {
  for (const backend of [
    { type: "local" },
    { type: "provider", id: "remote", config: {} },
  ]) {
    assert.equal(
      welcomeTeammateNeedsRestart(
        {
          ...bosun,
          backend,
          status: "running",
          needsRestart: false,
          respondTo: "owner-only",
          respondToAllowlist: [],
        },
        navigator.pubkey,
        true,
      ),
      false,
    );
  }
});

test("owner-only-access policy still restarts running teammates for runtime changes", () => {
  assert.equal(
    welcomeTeammateNeedsRestart(
      {
        ...bosun,
        backend: { type: "local" },
        status: "running",
        needsRestart: true,
        respondTo: "owner-only",
        respondToAllowlist: [],
      },
      navigator.pubkey,
      true,
    ),
    true,
  );
});

test("opener keeps partial-readiness warm and mentions only online teammates", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const introTeammates = selectWelcomeKickoffIntroTeammates(
    agentSet.teammates,
    [bosun],
  );
  const input = buildWelcomeKickoffOpenerSendInput(
    agentSet,
    introTeammates,
    "welcome-1",
  );

  assert.deepEqual(input.mentionPubkeys, [bosun.pubkey]);
  assert.deepEqual(input.additionalMarkers, []);
  assert.match(input.content, /@Bosun, introduce yourself/);
  assert.doesNotMatch(input.content, /@@/);
  assert.doesNotMatch(
    input.content,
    /Lookout.*trouble|couldn't start|taking longer/i,
  );
});

test("opener greets the owner by name and tags their pubkey", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const owner = { pubkey: "owner-pubkey-hex", displayName: "Morgan" };
  const input = buildWelcomeKickoffOpenerSendInput(
    agentSet,
    agentSet.teammates,
    "welcome-1",
    owner,
  );

  assert.deepEqual(input.mentionPubkeys, [
    bosun.pubkey,
    lookout.pubkey,
    owner.pubkey,
  ]);
  assert.match(input.content, /^Hi @Morgan, I'm Navigator\./);
  // The raw pubkey must never leak into the visible copy.
  assert.doesNotMatch(input.content, /owner-pubkey-hex/);
});

test("opener falls back to an unnamed greeting when the display name is missing", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const owner = { pubkey: "owner-pubkey-hex", displayName: "  " };
  const input = buildWelcomeKickoffOpenerSendInput(
    agentSet,
    agentSet.teammates,
    "welcome-1",
    owner,
  );

  // Still tagged for the Inbox mentions feed, just no visible greeting name.
  assert.ok(input.mentionPubkeys.includes(owner.pubkey));
  assert.match(input.content, /^Hi, I'm Navigator\./);
  assert.doesNotMatch(input.content, /@\s/);
});

test("opener greets and tags the owner even when no teammates come online", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const input = buildWelcomeKickoffOpenerSendInput(agentSet, [], "welcome-1", {
    pubkey: "owner-pubkey-hex",
    displayName: "Morgan",
  });

  assert.deepEqual(input.mentionPubkeys, ["owner-pubkey-hex"]);
  assert.equal(input.additionalMarkers.length, 1);
  assert.match(input.content, /^Hi @Morgan, I'm Navigator\./);
});

test("opener does not duplicate the owner pubkey if already mentioned", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const input = buildWelcomeKickoffOpenerSendInput(
    agentSet,
    [bosun],
    "welcome-1",
    { pubkey: bosun.pubkey, displayName: bosun.name },
  );

  assert.deepEqual(input.mentionPubkeys, [bosun.pubkey]);
});

test("opener degrades to one seeded Navigator message when no teammate comes online", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const input = buildWelcomeKickoffOpenerSendInput(agentSet, [], "welcome-1");

  assert.deepEqual(input.mentionPubkeys, []);
  assert.equal(input.additionalMarkers.length, 1);
  assert.match(input.content, /I'm here with Bosun and Lookout/);
  assert.match(input.content, /What can we help you build/);
  assert.doesNotMatch(
    input.content,
    /introduce yourselves|trouble|couldn't start|taking longer/i,
  );
});

test("readiness wait returns the subset that became online by the deadline", async () => {
  const online = await waitForWelcomeTeammatesOnline([bosun, lookout], {
    isCancelled: () => false,
    loadPresence: async () => ({
      [bosun.pubkey]: "online",
      [lookout.pubkey]: "offline",
    }),
    pollMs: 0,
    waitMs: 0,
  });

  assert.deepEqual(online, [bosun]);
});

function relayEvent({ id, pubkey, createdAt = 1, tags = [], content = "" }) {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 9,
    tags,
    content,
    sig: "sig",
  };
}

test("closer classification sees replies that arrive during the final beat", async () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const opener = relayEvent({
    id: "opener",
    pubkey: navigator.pubkey,
    tags: [["client", "buzz-welcome-kickoff.opener.v1"]],
  });
  const events = [opener];

  const beforeBeat = classifyWelcomeKickoffResolution(events, opener, agentSet);
  assert.deepEqual(
    beforeBeat.unresolved.map((agent) => agent.name),
    ["Bosun", "Lookout"],
  );

  const beat = waitForWelcomeKickoffBeat({ waitMs: 5 });
  events.push(
    relayEvent({
      id: "bosun-intro",
      pubkey: bosun.pubkey,
      createdAt: 2,
      tags: [
        ["e", opener.id, "", "root"],
        ["e", opener.id, "", "reply"],
      ],
    }),
  );
  assert.equal(await beat, true);

  const afterBeat = classifyWelcomeKickoffResolution(events, opener, agentSet);
  assert.deepEqual(
    afterBeat.unresolved.map((agent) => agent.name),
    ["Lookout"],
  );
});

function introReply(id, pubkey, openerId) {
  return relayEvent({
    id,
    pubkey,
    createdAt: 2,
    tags: [
      ["e", openerId, "", "root"],
      ["e", openerId, "", "reply"],
    ],
  });
}

const kickoffOpener = relayEvent({
  id: "opener",
  pubkey: navigator.pubkey,
  tags: [["client", "buzz-welcome-kickoff.opener.v1"]],
});

// The bug this branch fixes: teammate intros are thread replies, which the
// channel window excludes from the main timeline. So the kickoff saw the
// opener and never the intros, and the closer stalled until the user happened
// to click into the thread. Merging the opener's subtree in is the fix.
test("intro replies reach the closer classification without the user opening the thread", () => {
  const agentSet = { lead: navigator, teammates: [bosun, lookout] };
  const channelEvents = [kickoffOpener];
  const openerReplies = [
    introReply("bosun-intro", bosun.pubkey, kickoffOpener.id),
    introReply("lookout-intro", lookout.pubkey, kickoffOpener.id),
  ];

  // Pin the pre-fix behaviour: on the channel events alone, both teammates
  // look silent forever. This is what stalled the closer.
  assert.deepEqual(
    classifyWelcomeKickoffResolution(
      channelEvents,
      kickoffOpener,
      agentSet,
    ).unresolved.map((agent) => agent.name),
    ["Bosun", "Lookout"],
  );

  // With the subtree merged in, the same intros resolve the kickoff.
  assert.deepEqual(
    classifyWelcomeKickoffResolution(
      mergeKickoffEvents(channelEvents, openerReplies),
      kickoffOpener,
      agentSet,
    ).unresolved,
    [],
  );
});

test("merging the opener subtree never double-counts an already-visible reply", () => {
  const bosunIntro = introReply("bosun-intro", bosun.pubkey, kickoffOpener.id);
  // An open thread feeds the same replies in through both sources.
  const merged = mergeKickoffEvents(
    [kickoffOpener, bosunIntro],
    [bosunIntro, introReply("lookout-intro", lookout.pubkey, kickoffOpener.id)],
  );

  assert.deepEqual(
    merged.map((event) => event.id),
    ["opener", "bosun-intro", "lookout-intro"],
  );
});

test("merging with no subtree replies leaves the channel events untouched", () => {
  const channelEvents = [kickoffOpener];
  assert.equal(mergeKickoffEvents(channelEvents, []), channelEvents);
});
