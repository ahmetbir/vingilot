// The join, the reading, and the bar's one line
// (vingilot/docs/plans/2026-08-12-hooks-and-the-dots.md, Task 3).
//
// The rule these exist to hold is the same negative one the dots are built on:
// **a shape this reader cannot understand is no answer**, not a partial one. A
// backend one build behind its frontend is an ordinary Tuesday here (`tauri
// dev` against a stale binary), and the failure it must not produce is
// `claude · undefined` on the bottom bar.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentFor,
  agentSegment,
  NO_AGENTS,
  readLiveAgents,
} from "./liveAgents.ts";

function agent(overrides = {}) {
  return {
    path: null,
    sentence: "working",
    sessions: 1,
    state: "working",
    tool: null,
    ...overrides,
  };
}

test("a well-formed answer is read whole", () => {
  const answer = readLiveAgents({
    byBinding: {
      "local:2f77": {
        path: "/w/one",
        sentence: "waiting for approval: Bash",
        sessions: 1,
        state: "asking",
        tool: "Bash",
      },
    },
    unattributed: {
      path: null,
      sentence: "working",
      sessions: 2,
      state: "working",
      tool: null,
    },
  });
  assert.deepEqual(answer.byBinding["local:2f77"], {
    path: "/w/one",
    sentence: "waiting for approval: Bash",
    sessions: 1,
    state: "asking",
    tool: "Bash",
  });
  assert.equal(answer.unattributed.sessions, 2);
});

test("nothing this reader understands is no answer, never a half one", () => {
  // Each of these is a shape a mismatched build produces, and every one of them
  // must draw nothing rather than reach a sentence.
  for (const raw of [
    null,
    undefined,
    "hook_liveness is not a string",
    {},
    { byBinding: null },
    { byBinding: "nope" },
  ]) {
    assert.deepEqual(readLiveAgents(raw), NO_AGENTS, JSON.stringify(raw));
  }
});

test("one unreadable record does not cost the readable ones", () => {
  const answer = readLiveAgents({
    byBinding: {
      "local:bad-sentence": { ...agent(), sentence: "" },
      "local:bad-state": { ...agent(), state: "thinking" },
      "local:good": agent({ sentence: "working — Bash", tool: "Bash" }),
      "local:not-an-object": 7,
    },
    unattributed: { state: "working" },
  });
  assert.deepEqual(Object.keys(answer.byBinding), ["local:good"]);
  assert.equal(
    answer.unattributed,
    null,
    "a record with no sentence has nothing to say and is not kept",
  );
});

test("a sessions count this build cannot read falls back to one, not to zero", () => {
  // The number reaches a sentence ("2 agents…"), so a missing one must not
  // become 0 — "0 agents in this worktree's terminals" would be a live session
  // reported as nobody.
  const answer = readLiveAgents({
    byBinding: { "local:a": { ...agent(), sessions: undefined } },
  });
  assert.equal(answer.byBinding["local:a"].sessions, 1);
});

test("the join is by binding id first", () => {
  const agents = readLiveAgents({
    byBinding: { "local:a": agent({ path: "/w/one" }) },
  });
  assert.equal(agentFor(agents, "local:a", null).path, "/w/one");
  assert.equal(agentFor(agents, "local:b", null), null);
});

test("a checkout whose id no path can produce is found by directory", () => {
  // A project's own checkout carries a synthetic `main:<repo>` that the backend
  // cannot derive from a cwd, so its agent is filed under the `local:` id of
  // the same directory. Without this fallback the one checkout the owner is
  // most likely to run `claude` in is the one this feature cannot see.
  const agents = readLiveAgents({
    byBinding: { "local:2f77": agent({ path: "/w/repo" }) },
  });
  assert.equal(agentFor(agents, "main:repo-1", "/w/repo").sentence, "working");
  assert.equal(agentFor(agents, "main:repo-1", "/w/other"), null);
  assert.equal(
    agentFor(agents, "main:repo-1", null),
    null,
    "a row with no directory to compare has only its id",
  );
});

test("the bar says nothing when nothing has answered", () => {
  // Absence says nothing: a segment reading "claude · none" would be this bar
  // claiming to know a terminal is idle, which is exactly what the decay in
  // the store exists to stop anyone claiming.
  assert.equal(agentSegment(null), null);
});

test("the bar prefixes the harness and renders the harness's own words", () => {
  // The sentence is `state.rs`'s, whole — one vocabulary for the bar and the
  // store, which is why `Liveness::word` names this bar as its caller.
  assert.equal(
    agentSegment(agent({ sentence: "working — Bash", tool: "Bash" })),
    "claude · working — Bash",
  );
  assert.equal(
    agentSegment(
      agent({ sentence: "waiting for approval: Bash", state: "asking" }),
    ),
    "claude · waiting for approval: Bash",
  );
});
