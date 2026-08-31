// Review's pure decisions: who can review, the default pick, where the
// message goes, and what it says — mirrors crewReach.test.mjs's own cases
// where the rule is shared (blocked threads, Mate's DM, the mention rule).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultReviewer,
  resolveStoredReviewer,
  reviewDestination,
  reviewersFromAgents,
  reviewMessage,
} from "./reviewDispatch.ts";

const LOOKOUT = {
  name: "Lookout",
  personaId: "builtin:lookout",
  pubkey: "a".repeat(64),
};
const MATE = {
  name: "Mate",
  personaId: "builtin:mate",
  pubkey: "b".repeat(64),
};
const BOSUN = {
  name: "Bosun",
  personaId: "builtin:bosun",
  pubkey: "c".repeat(64),
};

test("no minted agents is no reviewers", () => {
  assert.deepEqual(reviewersFromAgents([]), []);
});

test("only crew personas become reviewers — a non-crew agent draws no row", () => {
  const roster = reviewersFromAgents([
    LOOKOUT,
    { name: "Custom", personaId: "not-crew", pubkey: "d".repeat(64) },
    { name: "No persona", personaId: null, pubkey: "e".repeat(64) },
  ]);
  assert.deepEqual(
    roster.map((r) => r.personaId),
    ["builtin:lookout"],
  );
});

test("the record's own name is what the reviewer is called, not the roster default", () => {
  const [reviewer] = reviewersFromAgents([{ ...LOOKOUT, name: "Watch" }]);
  assert.equal(reviewer.name, "Watch");
  assert.equal(reviewer.berth, "thread");
});

test("Mate's berth is dm — carried through from crewRoster.ts", () => {
  const [reviewer] = reviewersFromAgents([MATE]);
  assert.equal(reviewer.berth, "dm");
});

test("defaultReviewer prefers Lookout, the reviewer job in crewRoster.ts", () => {
  const roster = reviewersFromAgents([MATE, BOSUN, LOOKOUT]);
  assert.equal(defaultReviewer(roster)?.personaId, "builtin:lookout");
});

test("defaultReviewer falls back to the first reviewer this workspace actually has", () => {
  const roster = reviewersFromAgents([MATE, BOSUN]);
  assert.equal(defaultReviewer(roster)?.personaId, "builtin:mate");
});

test("defaultReviewer answers null for an empty roster — nothing to pick", () => {
  assert.equal(defaultReviewer([]), null);
});

test("resolveStoredReviewer keeps the stored pick when this workspace still has it", () => {
  const roster = reviewersFromAgents([MATE, BOSUN, LOOKOUT]);
  assert.equal(
    resolveStoredReviewer(roster, "builtin:bosun")?.personaId,
    "builtin:bosun",
  );
});

test("resolveStoredReviewer falls back to the default when the stored pick is gone", () => {
  const roster = reviewersFromAgents([MATE, BOSUN]);
  assert.equal(
    resolveStoredReviewer(roster, "builtin:lookout")?.personaId,
    "builtin:mate",
  );
});

test("a thread-berth reviewer with no thread open is blocked with a sentence", () => {
  const [reviewer] = reviewersFromAgents([LOOKOUT]);
  const destination = reviewDestination(reviewer, null);
  assert.equal(destination.kind, "blocked");
  assert.match(destination.reason, /no team thread yet/);
});

test("a thread-berth reviewer with a thread goes to that channel", () => {
  const [reviewer] = reviewersFromAgents([LOOKOUT]);
  const destination = reviewDestination(reviewer, "channel-1");
  assert.deepEqual(destination, { channelId: "channel-1", kind: "thread" });
});

test("Mate is never blocked on a thread it is deliberately not in", () => {
  const [reviewer] = reviewersFromAgents([MATE]);
  assert.deepEqual(reviewDestination(reviewer, null), { kind: "dm" });
});

test("reviewMessage addresses a thread-berth reviewer by name — the harness's own mention rule", () => {
  const [reviewer] = reviewersFromAgents([{ ...LOOKOUT, name: "Watch" }]);
  assert.equal(
    reviewMessage(reviewer, "check the diff"),
    "@Watch check the diff",
  );
});

test("reviewMessage never mentions Mate — a DM has one other party", () => {
  const [reviewer] = reviewersFromAgents([MATE]);
  assert.equal(reviewMessage(reviewer, "check the diff"), "check the diff");
});

test("reviewMessage trims the instruction before addressing it", () => {
  const [reviewer] = reviewersFromAgents([LOOKOUT]);
  assert.equal(
    reviewMessage(reviewer, "  check the diff  "),
    "@Lookout check the diff",
  );
});
