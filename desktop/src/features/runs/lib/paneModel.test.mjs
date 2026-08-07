import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentAvailability,
  clampRatio,
  DEFAULT_RATIO,
  defaultPaneState,
  diffAvailability,
  evidenceAvailability,
  LEFT_PANE,
  MAX_RATIO,
  MIN_RATIO,
  nudgeRatio,
  PANE_IDS,
  panesFor,
  ratioFromPointer,
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
  return { cwd: "/tmp/wt", cwdPending: false, ownerRunId: null, ...over };
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
