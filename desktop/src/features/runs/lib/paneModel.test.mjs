import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_HARNESS_PROBE,
  agentAvailability,
  clampRatio,
  DEFAULT_RATIO,
  defaultPaneState,
  diffAvailability,
  evidenceAvailability,
  LEFT_PANE,
  MAX_RATIO,
  MIN_RATIO,
  noProbes,
  nudgeRatio,
  PANE_IDS,
  panesFor,
  probeReader,
  probeSlot,
  ratioFromPointer,
  readProbeFinding,
  resetRatio,
  rightChoices,
  runsAvailability,
  terminalAvailability,
  toggleCollapsed,
  withCollapsed,
  withRatio,
  withRight,
} from "./paneModel.ts";

const WT = "binding-1";

function ctx(over = {}) {
  const { probe, ...facts } = over;
  return {
    cwd: "/tmp/wt",
    cwdPending: false,
    ownerRunId: null,
    probe: probe ?? (() => ({ answer: "yes", detail: null })),
    worktreeId: WT,
    ...facts,
  };
}

function answering(answer, detail = null) {
  return () => ({ answer, detail });
}

test("a worktree nobody has arranged gets the split, open, with Diff", () => {
  const state = panesFor({}, WT);
  assert.equal(state.collapsed, false);
  assert.equal(state.right, "diff");
  assert.equal(state.ratio, DEFAULT_RATIO);
  assert.deepEqual(defaultPaneState(), state);
});

test("the right picker offers every pane except the one on the left", () => {
  const choices = rightChoices();
  assert.ok(!choices.includes(LEFT_PANE));
  assert.equal(choices.length, PANE_IDS.length - 1);
  for (const id of PANE_IDS) {
    if (id !== LEFT_PANE) assert.ok(choices.includes(id), id);
  }
});

test("an arrangement is remembered per worktree, not per app", () => {
  let layout = withRight({}, "a", "runs");
  layout = withRatio(layout, "b", 0.35);
  assert.equal(panesFor(layout, "a").right, "runs");
  assert.equal(panesFor(layout, "a").ratio, DEFAULT_RATIO);
  assert.equal(panesFor(layout, "b").right, "diff");
  assert.equal(panesFor(layout, "b").ratio, 0.35);
});

test("choosing a pane opens a collapsed slot — picking one means showing it", () => {
  const collapsed = withCollapsed({}, WT, true);
  assert.equal(panesFor(collapsed, WT).collapsed, true);
  const chosen = withRight(collapsed, WT, "evidence");
  assert.equal(panesFor(chosen, WT).collapsed, false);
  assert.equal(panesFor(chosen, WT).right, "evidence");
});

test("collapse and restore return the same pane, not a default", () => {
  let layout = withRight({}, WT, "runs");
  layout = toggleCollapsed(layout, WT);
  assert.equal(panesFor(layout, WT).collapsed, true);
  assert.equal(panesFor(layout, WT).right, "runs");
  layout = toggleCollapsed(layout, WT);
  assert.deepEqual(panesFor(layout, WT), {
    collapsed: false,
    ratio: DEFAULT_RATIO,
    right: "runs",
  });
});

test("neither side can be squeezed to a sliver", () => {
  assert.equal(clampRatio(0), MIN_RATIO);
  assert.equal(clampRatio(1), MAX_RATIO);
  assert.equal(clampRatio(-5), MIN_RATIO);
  assert.equal(clampRatio(Number.NaN), DEFAULT_RATIO);
  assert.equal(clampRatio(Number.POSITIVE_INFINITY), DEFAULT_RATIO);
  assert.equal(panesFor(withRatio({}, WT, 0.99), WT).ratio, MAX_RATIO);
  assert.equal(panesFor(withRatio({}, WT, 0.01), WT).ratio, MIN_RATIO);
});

test("nudging walks the ratio and stops at the clamp", () => {
  let layout = nudgeRatio({}, WT, 0.05);
  assert.ok(Math.abs(panesFor(layout, WT).ratio - 0.65) < 1e-9);
  for (let i = 0; i < 100; i += 1) layout = nudgeRatio(layout, WT, -0.02);
  assert.equal(panesFor(layout, WT).ratio, MIN_RATIO);
  assert.equal(panesFor(resetRatio(layout, WT), WT).ratio, DEFAULT_RATIO);
});

test("a no-op returns the same layout object, so no write is provoked", () => {
  const layout = withRight({}, WT, "runs");
  assert.equal(withRight(layout, WT, "runs"), layout);
  assert.equal(withCollapsed(layout, WT, false), layout);
  assert.equal(withRatio(layout, WT, DEFAULT_RATIO), layout);
  assert.notEqual(withRight(layout, WT, "diff"), layout);
});

test("a drag reads as a ratio of the surface it is inside", () => {
  assert.equal(ratioFromPointer(100, 1000, 600), 0.5);
  assert.equal(ratioFromPointer(0, 1000, 999), MAX_RATIO);
  assert.equal(ratioFromPointer(0, 1000, -50), MIN_RATIO);
});

test("a surface with no width to divide answers nothing, not a floor", () => {
  assert.equal(ratioFromPointer(0, 0, 40), null);
  assert.equal(ratioFromPointer(0, -10, 40), null);
  assert.equal(ratioFromPointer(Number.NaN, 100, 40), null);
  assert.equal(ratioFromPointer(0, 100, Number.NaN), null);
});

test("a pane with no backing says so instead of rendering empty", () => {
  const diff = diffAvailability(ctx({ cwd: null }));
  assert.equal(diff.status, "unavailable");
  assert.match(diff.reason, /git/);
  const agent = agentAvailability(ctx({ cwd: null }));
  assert.equal(agent.status, "unavailable");
  const evidence = evidenceAvailability(ctx());
  assert.equal(evidence.status, "unavailable");
  assert.match(evidence.reason, /no run owns this worktree/);
});

test("an answer that has not arrived is pending, never a refusal", () => {
  const pending = ctx({ cwd: null, cwdPending: true });
  assert.equal(diffAvailability(pending).status, "pending");
  assert.equal(agentAvailability(pending).status, "pending");
});

test("a pane with its backing present is available", () => {
  assert.equal(diffAvailability(ctx()).status, "available");
  assert.equal(agentAvailability(ctx()).status, "available");
  assert.equal(
    evidenceAvailability(ctx({ ownerRunId: "run-1" })).status,
    "available",
  );
  assert.equal(runsAvailability().status, "available");
  assert.equal(terminalAvailability().status, "available");
});

test("the terminal is available even with nothing resolved — it says so itself", () => {
  assert.equal(terminalAvailability().status, "available");
});

test("a pane can refuse on a question no fact could answer", () => {
  const none = agentAvailability(
    ctx({
      probe: answering(
        "no",
        "no ACP agent is configured — set VINGILOT_AGENT.",
      ),
    }),
  );
  assert.equal(none.status, "unavailable");
  // The probe's own sentence, not a generic one: a pane that knows why says
  // why, and the picker prints it on the disabled row.
  assert.match(none.reason, /VINGILOT_AGENT/);
  assert.equal(
    agentAvailability(ctx({ probe: answering("yes") })).status,
    "available",
  );
});

test("a question still being asked is pending, and one that could not be asked is not a refusal", () => {
  assert.equal(
    agentAvailability(ctx({ probe: answering("asking") })).status,
    "pending",
  );
  assert.equal(
    agentAvailability(ctx({ probe: answering("unknown") })).status,
    "available",
  );
  assert.equal(
    agentAvailability(ctx({ probe: noProbes() })).status,
    "available",
  );
});

test("a probe with no keyOf is one question for the machine; one with a keyOf is one per answer", () => {
  const machine = { ask: async () => null, id: "docker" };
  const perTree = {
    ask: async () => null,
    id: "repo",
    keyOf: (f) => f.cwd ?? "",
  };
  const here = ctx();
  const there = ctx({ cwd: "/tmp/other" });
  assert.equal(probeSlot(machine, here), probeSlot(machine, there));
  assert.notEqual(probeSlot(perTree, here), probeSlot(perTree, there));
});

test("a finding says yes, no, or that the question could not be put", () => {
  assert.deepEqual(readProbeFinding({ present: true }), {
    answer: "yes",
    detail: null,
  });
  assert.deepEqual(readProbeFinding({ detail: "why", present: false }), {
    answer: "no",
    detail: "why",
  });
  assert.deepEqual(readProbeFinding(null), { answer: "unknown", detail: null });
});

test("an unrecorded answer reads as asking, and an unregistered question as unknown", () => {
  const probe = { ask: async () => null, id: "docker" };
  const facts = ctx();
  const read = probeReader([probe], {}, facts);
  assert.equal(read("docker").answer, "asking");
  // Nobody registered this one. Reading that as "no" would be an empty read
  // taken for a refusal.
  assert.equal(read("nobody-asked-this").answer, "unknown");
  const answered = probeReader(
    [probe],
    { [probeSlot(probe, facts)]: { answer: "no", detail: "no daemon" } },
    facts,
  );
  assert.equal(answered("docker").detail, "no daemon");
});

test("the probe id the Agent pane is written against is the one the registry answers", () => {
  const asked = [];
  agentAvailability(
    ctx({
      probe: (id) => {
        asked.push(id);
        return { answer: "yes", detail: null };
      },
    }),
  );
  assert.deepEqual(asked, [AGENT_HARNESS_PROBE]);
});
