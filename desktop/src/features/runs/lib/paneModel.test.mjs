import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_HARNESS_PROBE,
  agentAvailability,
  clampRatio,
  clampRatioAt,
  DEFAULT_RATIO,
  defaultPaneState,
  diffAvailability,
  DIVIDER_PX,
  evidenceAvailability,
  LEFT_PANE,
  MAX_RATIO,
  MIN_LEFT_PX,
  MIN_RATIO,
  MIN_RIGHT_PX,
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

/** A surface nobody has measured — before the work surface's first layout
 * effect. `clampRatioAt` reads it as "no floors to apply", so a test using it
 * is asking about the taste clamp and nothing else. */
const UNMEASURED = 0;

/** Wide enough that the terminal's floor is well below anything asked for
 * here, so the taste clamp is what binds. */
const WIDE = 2000;

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
  layout = withRatio(layout, "b", 0.35, UNMEASURED);
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
  assert.equal(
    panesFor(withRatio({}, WT, 0.99, UNMEASURED), WT).ratio,
    MAX_RATIO,
  );
  assert.equal(
    panesFor(withRatio({}, WT, 0.01, UNMEASURED), WT).ratio,
    MIN_RATIO,
  );
});

test("nudging walks the ratio and stops at the clamp", () => {
  let layout = nudgeRatio({}, WT, 0.05, UNMEASURED);
  assert.ok(Math.abs(panesFor(layout, WT).ratio - 0.65) < 1e-9);
  for (let i = 0; i < 100; i += 1) {
    layout = nudgeRatio(layout, WT, -0.02, UNMEASURED);
  }
  assert.equal(panesFor(layout, WT).ratio, MIN_RATIO);
  assert.equal(
    panesFor(resetRatio(layout, WT, UNMEASURED), WT).ratio,
    DEFAULT_RATIO,
  );
});

test("what is stored is a ratio the surface allowed, not one a key asked for", () => {
  // The defect this closes: a drag arrived pre-clamped by `ratioFromPointer`,
  // an arrow press arrived clamped by taste alone. Nothing moved at the time —
  // the render re-clamps — so what shipped was a *stored* ratio the surface had
  // never allowed, waiting for a window width that would honour it and move a
  // divider nobody had touched.
  const surface = 1195;
  const floor = clampRatioAt(0, surface);
  assert.ok(floor > MIN_RATIO, "the floor is the interesting clamp here");

  const home = panesFor(withRatio({}, WT, MIN_RATIO, surface), WT).ratio;
  assert.equal(home, floor);
  const walked = panesFor(nudgeRatio({}, WT, -1, surface), WT).ratio;
  assert.equal(walked, floor);
  assert.equal(renderedColumns(renderedLeftPx(home, surface)), 80);

  // And the value that survives is one a wider window cannot reinterpret: it
  // is already inside every clamp that surface has.
  assert.equal(clampRatioAt(home, surface), home);
});

test("a no-op returns the same layout object, so no write is provoked", () => {
  const layout = withRight({}, WT, "runs");
  assert.equal(withRight(layout, WT, "runs"), layout);
  assert.equal(withCollapsed(layout, WT, false), layout);
  assert.equal(withRatio(layout, WT, DEFAULT_RATIO, WIDE), layout);
  assert.notEqual(withRight(layout, WT, "diff"), layout);
});

// What the browser gives the left pane, worked out from the row `WorkSurface`
// draws rather than from the model that sizes it: three members — a left
// `<section>` with `basis-0` and `flexGrow: share`, an 8px divider, a right
// `<section>` the same way. Flexbox hands the two sections whatever the
// divider leaves, in proportion to their grow factors.
//
// **The 8 and the two numbers below are written out, not imported.** A test
// that borrowed the constants it is checking cannot see them move, and that is
// precisely how a floor named "80 columns" shipped landing 79: the old
// assertion was `clampRatioAt(0.01, w) * w === MIN_LEFT_PX`, which is the
// model's arithmetic against itself and passes at any consistent wrongness.
const RENDERED_DIVIDER_PX = 8;

function renderedLeftPx(ratio, surfaceWidth) {
  return (surfaceWidth - RENDERED_DIVIDER_PX) * ratio;
}

/** Columns of @xterm/xterm's stock 15px monospace that fit in a left pane of
 * `px`, both numbers measured on the real surface: a 636px pane fits 68
 * columns, which is 9.1px a column once the pane's `px-2` and xterm's
 * scrollbar gutter — 32px together — are out of it. */
function renderedColumns(px) {
  return Math.floor((px - 32) / 9);
}

test("no drag can take the terminal under 80 columns while the surface can hold it", () => {
  // The measured defect: on a 549px surface the ratio clamp let a drag reach
  // 12 columns, and under tmux the attached client's size is the session's
  // size — every line of the scrollback re-wraps and dragging back does not
  // un-wrap it.
  //
  // 1195 is the surface a maximised window on the owner's display gives, and
  // the width at which the floor was landing 747px/79 columns.
  for (const surface of [1195, 1280, 2000]) {
    for (const asked of [0.01, MIN_RATIO, 0.3]) {
      const left = renderedLeftPx(clampRatioAt(asked, surface), surface);
      assert.ok(
        renderedColumns(left) >= 80,
        `${surface}px surface, asked ${asked}: ${renderedColumns(left)} columns in ${left}px`,
      );
    }
    const dragged = ratioFromPointer(0, surface, 10);
    assert.ok(
      renderedColumns(renderedLeftPx(dragged, surface)) >= 80,
      `${surface}px surface, dragged to the left edge`,
    );
  }
});

test("the floor is a floor and not a layout — it costs the terminal nothing it asked for", () => {
  // One column over the floor is what the floor should cost, not none and not
  // two: a floor that overshot would be a layout this file had chosen for him.
  const surface = 1195;
  const left = renderedLeftPx(clampRatioAt(0.01, surface), surface);
  assert.equal(renderedColumns(left), 80);
  assert.equal(Math.round(left), MIN_LEFT_PX);
});

test("the right pane keeps a floor of its own at the other end", () => {
  const surface = 1000;
  const shared = surface - RENDERED_DIVIDER_PX;
  const right = shared - renderedLeftPx(clampRatioAt(0.99, surface), surface);
  assert.ok(Math.abs(right - MIN_RIGHT_PX) < 1e-9, `${right}px right pane`);
});

test("the pointer aims at the divider's middle, which is where the boundary looks", () => {
  // The divider stands in the row rather than being drawn on the boundary, so
  // a pointer 1100px into a 2000px surface starting at 100 is holding a
  // divider whose left edge is at 996 — half the surface, not 1000/2000 of it.
  assert.equal(ratioFromPointer(100, 2000, 1100), 0.5);
  assert.equal(ratioFromPointer(0, 2000, 1999), MAX_RATIO);
});

test("a surface too narrow for both floors still keeps the terminal's 80 columns", () => {
  // The band where the two floors conflict starts at 992px of shared width and
  // is not exotic: a 1280 window with the sidebar and the worktree column open
  // is already inside it. The taste cap used to bind here instead of the
  // floor — measured, a 900px surface gave the terminal 75 columns while the
  // comment above the clamp said the terminal's floor had won.
  for (const surface of [990, 940, 900, 800, 770]) {
    assert.ok(
      surface - RENDERED_DIVIDER_PX < MIN_LEFT_PX + MIN_RIGHT_PX,
      `${surface}px should be inside the conflict band`,
    );
    const left = renderedLeftPx(clampRatioAt(DEFAULT_RATIO, surface), surface);
    assert.ok(
      renderedColumns(left) >= 80,
      `${surface}px surface: ${renderedColumns(left)} columns in ${left}px`,
    );
  }
});

test("the right pane gives way to the terminal, not the other way round", () => {
  // Ranked, not balanced. What a narrow Diff pane costs is legibility; what a
  // narrow terminal costs is the scrollback, and tmux does not give that back.
  const surface = 900;
  const shared = surface - RENDERED_DIVIDER_PX;
  const left = renderedLeftPx(clampRatioAt(DEFAULT_RATIO, surface), surface);
  assert.equal(renderedColumns(left), 80);
  assert.ok(shared - left < MIN_RIGHT_PX, "the right pane is the one squeezed");
});

test("a surface too narrow even for the terminal gives it everything there is", () => {
  // 549px is the real measurement: sidebar plus worktree column on a 1280
  // window. Nothing here is a good layout, and it is not dressed up as one —
  // the right pane gets nothing, because the alternative is spending the
  // terminal's columns on a pane that cannot be read at that width either.
  // ⌥⌘B, or a wider window, is the way out.
  const narrow = 549;
  assert.ok(MIN_LEFT_PX + DIVIDER_PX > narrow);
  assert.equal(clampRatioAt(0.01, narrow), 1);
  assert.equal(clampRatioAt(0.99, narrow), 1);
  assert.equal(clampRatioAt(DEFAULT_RATIO, narrow), 1);
  // Still short of 80, and nothing in this file can conjure them — but it is
  // 56 rather than the 45 the taste cap was handing out.
  const left = renderedLeftPx(1, narrow);
  assert.equal(left, narrow - RENDERED_DIVIDER_PX);
  assert.equal(renderedColumns(left), 56);
});

test("a wide surface leaves the ratio alone — the floors are floors, not a layout", () => {
  assert.equal(clampRatioAt(DEFAULT_RATIO, 2000), DEFAULT_RATIO);
  assert.equal(clampRatioAt(0.5, 2000), 0.5);
});

test("an unmeasured surface invents no floor", () => {
  // Reading a width nobody has measured as a real one is how a terminal gets
  // resized to a shape nobody laid out.
  assert.equal(clampRatioAt(DEFAULT_RATIO, 0), DEFAULT_RATIO);
  assert.equal(clampRatioAt(DEFAULT_RATIO, Number.NaN), DEFAULT_RATIO);
  assert.equal(clampRatioAt(0.99, 0), MAX_RATIO);
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
