import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABSENT_SETTLE_AFTER_MS,
  ABSENT_SETTLED_POLL_MS,
  controlPlaneBanner,
  controlPlaneKind,
  controlPlanePollMs,
  controlPlaneStatus,
  pinsUnavailableNote,
  runsUnavailableNote,
  unreachableView,
} from "./reachability.ts";

const T0 = new Date("2026-08-03T12:00:00.000Z");

test("unreachableView: reachable is nothing to render", () => {
  assert.equal(unreachableView(true, T0, T0, 2000), null);
});

test("unreachableView: reachable but since unknown (shouldn't happen, but null-safe)", () => {
  assert.equal(unreachableView(false, null, T0, 2000), null);
});

test("unreachableView: at the moment it flips, a full interval remains", () => {
  const v = unreachableView(false, T0, T0, 2000);
  assert.deepEqual(v, { since: T0, nextRetrySecs: 2 });
});

test("unreachableView: mid-interval countdown rounds up to the next whole second", () => {
  const now = new Date(T0.getTime() + 500);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 2); // 1500ms remaining -> ceil(1.5) = 2
});

test("unreachableView: countdown wraps across interval boundaries", () => {
  const now = new Date(T0.getTime() + 2500); // one full interval + 500ms
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 2);
});

test("unreachableView: just under a tick boundary", () => {
  const now = new Date(T0.getTime() + 1999);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.nextRetrySecs, 1);
});

test("unreachableView: since is carried through unchanged", () => {
  const now = new Date(T0.getTime() + 10_000);
  const v = unreachableView(false, T0, now, 2000);
  assert.equal(v.since, T0);
});

// Task 2: which sentence applies, and how hard the workspace looks for a
// coordinator that has never answered.

test("controlPlaneKind: an answering coordinator is reachable, answered before or not", () => {
  assert.equal(controlPlaneKind(true, true), "reachable");
  assert.equal(controlPlaneKind(true, false), "reachable");
});

test("controlPlaneKind: answered once and not now is an outage", () => {
  assert.equal(controlPlaneKind(false, true), "outage");
});

test("controlPlaneKind: never answered is absent, not an outage", () => {
  assert.equal(controlPlaneKind(false, false), "absent");
});

test("controlPlanePollMs: a reachable control plane keeps the fast cadence", () => {
  const late = new Date(T0.getTime() + ABSENT_SETTLE_AFTER_MS * 10);
  assert.equal(controlPlanePollMs("reachable", T0, late, 2000), 2000);
});

test("controlPlanePollMs: an outage keeps the fast cadence however long it lasts", () => {
  const late = new Date(T0.getTime() + ABSENT_SETTLE_AFTER_MS * 10);
  assert.equal(controlPlanePollMs("outage", T0, late, 2000), 2000);
});

test("controlPlanePollMs: absent keeps the fast cadence inside the first window", () => {
  const soon = new Date(T0.getTime() + ABSENT_SETTLE_AFTER_MS - 1);
  assert.equal(controlPlanePollMs("absent", T0, soon, 2000), 2000);
});

test("controlPlanePollMs: absent settles to the slow cadence after the window", () => {
  const after = new Date(T0.getTime() + ABSENT_SETTLE_AFTER_MS);
  assert.equal(
    controlPlanePollMs("absent", T0, after, 2000),
    ABSENT_SETTLED_POLL_MS,
  );
});

test("controlPlanePollMs: the slow cadence is slower than the fast one, and neither is zero", () => {
  assert.ok(ABSENT_SETTLED_POLL_MS > 2000);
  assert.ok(ABSENT_SETTLE_AFTER_MS > 0);
});

test("controlPlanePollMs: absent with no start time is not settled yet", () => {
  assert.equal(controlPlanePollMs("absent", null, T0, 2000), 2000);
});

test("controlPlaneBanner: a reachable control plane says nothing", () => {
  assert.equal(controlPlaneBanner("reachable", null, T0, 2000), null);
});

test("controlPlaneBanner: absent is a note, not an alert", () => {
  const banner = controlPlaneBanner("absent", null, T0, 2000);
  assert.equal(banner.tone, "note");
});

test("controlPlaneBanner: absent names runs as the one thing unavailable", () => {
  const banner = controlPlaneBanner("absent", null, T0, 2000);
  assert.match(banner.text, /runs cannot start/);
  assert.match(banner.text, /worktrees/);
  assert.match(banner.text, /terminals/);
  assert.match(banner.text, /notes/);
});

test("controlPlaneBanner: absent never counts seconds and never dates a failure", () => {
  const later = new Date(T0.getTime() + 137_000);
  const banner = controlPlaneBanner("absent", T0, later, 2000);
  assert.doesNotMatch(banner.text, /\d/);
  assert.doesNotMatch(banner.text, /since/i);
  assert.doesNotMatch(banner.text, /retry/i);
  // The same words whatever the clock and the cadence say — the state it
  // reports is not one that is ticking towards anything.
  assert.equal(
    banner.text,
    controlPlaneBanner("absent", null, T0, ABSENT_SETTLED_POLL_MS).text,
  );
});

test("controlPlaneBanner: absent says a coordinator started later is picked up", () => {
  const banner = controlPlaneBanner("absent", null, T0, 2000);
  assert.match(banner.text, /picks it up on its own/);
  assert.equal(banner.action, "Check now");
});

test("controlPlaneBanner: an outage is an alert, dated, with the countdown", () => {
  const now = new Date(T0.getTime() + 500);
  const banner = controlPlaneBanner("outage", T0, now, 2000);
  assert.equal(banner.tone, "alert");
  assert.match(banner.text, /not answering since/);
  assert.match(banner.text, new RegExp(T0.toLocaleTimeString()));
  assert.match(banner.text, /next in 2s/);
  assert.equal(banner.action, "Retry now");
});

test("controlPlaneBanner: an outage with no start time says nothing", () => {
  assert.equal(controlPlaneBanner("outage", null, T0, 2000), null);
});

test("controlPlaneBanner: neither sentence calls the workspace read-only", () => {
  const outage = controlPlaneBanner("outage", T0, T0, 2000);
  const absent = controlPlaneBanner("absent", null, T0, 2000);
  for (const banner of [outage, absent]) {
    assert.doesNotMatch(banner.text, /read-only/);
    // Both name what still works rather than leaving it to be guessed.
    assert.match(banner.text, /terminals/);
  }
});

test("controlPlaneBanner: neither sentence puts the team thread on this machine", () => {
  const outage = controlPlaneBanner("outage", T0, T0, 2000);
  const absent = controlPlaneBanner("absent", null, T0, 2000);
  for (const banner of [outage, absent]) {
    // The thread is the one item in the list that is not local — it is on the
    // relay (`teamThread.ts`). Saying otherwise is the same class of wrong
    // clause as "read-only" above, so it gets the same kind of gate: the
    // clause about what is on this machine may not reach the thread, in
    // either word order, and the thread must be named with where it is.
    assert.doesNotMatch(banner.text, /thread[^.]*\b(local|this machine)\b/i);
    assert.doesNotMatch(banner.text, /\b(local|this machine)\b[^.]*thread/i);
    assert.match(banner.text, /team thread is on the relay/);
  }
});

test("controlPlaneStatus: three states, three readings", () => {
  assert.equal(controlPlaneStatus("reachable"), "synced");
  assert.equal(controlPlaneStatus("outage"), "not answering");
  assert.equal(controlPlaneStatus("absent"), "no control plane");
});

test("controlPlaneStatus: a machine that never had one is not called unreachable", () => {
  assert.doesNotMatch(controlPlaneStatus("absent"), /unreachable/);
});

test("runsUnavailableNote: nothing to say while it answers", () => {
  assert.equal(runsUnavailableNote("reachable"), null);
});

test("runsUnavailableNote: the two refusals read differently", () => {
  assert.match(runsUnavailableNote("outage"), /not answering/);
  assert.match(
    runsUnavailableNote("absent"),
    /no control plane on this machine/,
  );
  assert.doesNotMatch(runsUnavailableNote("absent"), /unreachable/);
});

test("pinsUnavailableNote: nothing to say while it answers", () => {
  assert.equal(pinsUnavailableNote("reachable"), null);
});

test("pinsUnavailableNote: the two refusals read differently", () => {
  assert.match(pinsUnavailableNote("outage"), /not answering/);
  assert.match(pinsUnavailableNote("absent"), /pins are kept in it/);
  assert.doesNotMatch(pinsUnavailableNote("absent"), /unreachable/);
});
