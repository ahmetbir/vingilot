import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindingFor,
  parseTeamThreadBindings,
  readTeamThreadBindings,
  withChosenTeam,
  withNoTeam,
  withThreadChannel,
  writeTeamThreadBindings,
} from "./teamThreadStore.ts";

function shim(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    store,
  };
}

test("nothing stored reads as no bindings, not as a throw", () => {
  assert.deepEqual(parseTeamThreadBindings(null), {});
  assert.deepEqual(parseTeamThreadBindings(""), {});
  assert.deepEqual(parseTeamThreadBindings("{not json"), {});
  assert.deepEqual(parseTeamThreadBindings("[1,2]"), {});
});

test("one unreadable row does not cost the readable ones", () => {
  const parsed = parseTeamThreadBindings(
    JSON.stringify({
      "": { teamId: "team-x" },
      "binding-1": { channelId: "chan-1", teamId: "team-1" },
      "binding-2": { teamId: 7 },
      "binding-3": "nonsense",
    }),
  );
  assert.deepEqual(parsed, {
    "binding-1": { channelId: "chan-1", teamId: "team-1" },
  });
});

test("a chosen team with no thread yet reads back as exactly that", () => {
  const parsed = parseTeamThreadBindings(
    JSON.stringify({ "binding-1": { teamId: "team-1" } }),
  );
  assert.deepEqual(parsed["binding-1"], { channelId: null, teamId: "team-1" });
});

test("an empty channel id is no channel, not a channel called nothing", () => {
  const parsed = parseTeamThreadBindings(
    JSON.stringify({ "binding-1": { channelId: "", teamId: "team-1" } }),
  );
  assert.equal(parsed["binding-1"].channelId, null);
});

test("what is written is what comes back", () => {
  const storage = shim();
  writeTeamThreadBindings(
    { "binding-1": { channelId: "chan-1", teamId: "team-1" } },
    storage,
  );
  assert.deepEqual(readTeamThreadBindings(storage), {
    "binding-1": { channelId: "chan-1", teamId: "team-1" },
  });
});

test("a storage that refuses the write does not fail the render", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.doesNotThrow(() => writeTeamThreadBindings({}, storage));
});

test("choosing a team records it with no thread yet", () => {
  const next = withChosenTeam({}, "binding-1", "team-1");
  assert.deepEqual(next["binding-1"], { channelId: null, teamId: "team-1" });
});

test("choosing the team already chosen changes nothing at all", () => {
  const before = withChosenTeam({}, "binding-1", "team-1");
  // The same object, so a caller mirroring this into storage on every change
  // does not write on a no-op.
  assert.equal(withChosenTeam(before, "binding-1", "team-1"), before);
});

test("choosing a different team forgets where the old thread was, and only that", () => {
  const before = withThreadChannel(
    withChosenTeam({}, "binding-1", "team-1"),
    "binding-1",
    "team-1",
    "chan-1",
  );
  const after = withChosenTeam(before, "binding-1", "team-2");
  assert.deepEqual(after["binding-1"], { channelId: null, teamId: "team-2" });
});

test("forgetting a team drops the pointer and only this worktree's", () => {
  const bindings = withThreadChannel(
    withChosenTeam(
      withChosenTeam({}, "binding-1", "team-1"),
      "binding-2",
      "team-2",
    ),
    "binding-1",
    "team-1",
    "chan-1",
  );
  const after = withNoTeam(bindings, "binding-1");
  assert.equal(after["binding-1"], undefined);
  assert.deepEqual(after["binding-2"], { channelId: null, teamId: "team-2" });
  // The channel itself is on the relay and is not this store's to delete —
  // nothing here even knows how.
  assert.equal(bindings["binding-1"].channelId, "chan-1");
});

test("forgetting a worktree that had no team changes nothing", () => {
  const bindings = withChosenTeam({}, "binding-1", "team-1");
  assert.equal(withNoTeam(bindings, "binding-2"), bindings);
});

test("worktrees do not share a binding", () => {
  const bindings = withChosenTeam(
    withChosenTeam({}, "binding-1", "team-1"),
    "binding-2",
    "team-2",
  );
  assert.equal(bindings["binding-1"].teamId, "team-1");
  assert.equal(bindings["binding-2"].teamId, "team-2");
});

test("a thread that opened for a team no longer chosen is not written down", () => {
  // The open is asynchronous. An owner who switched teams while it was in
  // flight must not end up with the new team pointed at the old team's
  // channel — which is the one way this pointer could lie about who is in a
  // conversation.
  const bindings = withChosenTeam({}, "binding-1", "team-2");
  const after = withThreadChannel(bindings, "binding-1", "team-1", "chan-1");
  assert.equal(after, bindings);
  assert.equal(after["binding-1"].channelId, null);
});

test("a thread opened for a worktree nobody chose a team for is not written down", () => {
  assert.deepEqual(withThreadChannel({}, "binding-1", "team-1", "chan-1"), {});
});

test("recording the same channel twice changes nothing", () => {
  const before = withThreadChannel(
    withChosenTeam({}, "binding-1", "team-1"),
    "binding-1",
    "team-1",
    "chan-1",
  );
  assert.equal(
    withThreadChannel(before, "binding-1", "team-1", "chan-1"),
    before,
  );
});

test("a worktree with no binding, and no worktree at all, both read as none", () => {
  const bindings = withChosenTeam({}, "binding-1", "team-1");
  assert.equal(bindingFor(bindings, "binding-2"), null);
  assert.equal(bindingFor(bindings, null), null);
  assert.deepEqual(bindingFor(bindings, "binding-1"), {
    channelId: null,
    teamId: "team-1",
  });
});
