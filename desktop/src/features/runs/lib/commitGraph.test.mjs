import assert from "node:assert/strict";
import { test } from "node:test";

import {
  graphPixelWidth,
  graphWidth,
  laneBudget,
  laneColor,
  laneX,
  layoutCommitGraph,
  MAX_LANES,
  META_PX,
  MIN_LANES,
  scopeLabel,
  SUBJECT_MIN_PX,
  subjectParts,
} from "./commitGraph.ts";

/** A page of history, oldest last, written the way git answers: each entry is
 * `[hash, ...parents]`. */
function page(...rows) {
  return rows.map(([hash, ...parents]) => ({ hash, parents }));
}

test("a linear history is one lane, joined top to bottom", () => {
  const rows = layoutCommitGraph(page(["c", "b"], ["b", "a"], ["a"]));
  assert.deepEqual(
    rows.map((row) => row.lane),
    [0, 0, 0],
  );
  // The newest commit has nothing above it and the root has nothing below.
  assert.deepEqual(
    rows.map((row) => [row.up, row.down]),
    [
      [false, true],
      [true, true],
      [true, false],
    ],
  );
  for (const row of rows) {
    assert.deepEqual(row.through, [], "a single lane crosses nothing");
    assert.deepEqual(row.forks, []);
  }
  assert.equal(graphWidth(rows), 1);
});

test("a merge opens a second lane and closes it where the branch was cut", () => {
  // m ── merge of trunk `t` and side `s`; `s`'s own parent is `t2`, which is
  // also `t`'s parent — the diamond every merge makes.
  const rows = layoutCommitGraph(
    page(["m", "t", "s"], ["t", "t2"], ["s", "t2"], ["t2"]),
  );

  const [merge, trunk, side, base] = rows;
  assert.equal(merge.lane, 0);
  assert.deepEqual(merge.forks, [1], "the second parent goes off into lane 1");
  assert.equal(merge.up, false);
  assert.equal(merge.down, true);

  assert.equal(trunk.lane, 0);
  assert.deepEqual(trunk.through, [1], "the side branch crosses this row");

  assert.equal(
    side.lane,
    1,
    "the side commit is drawn in the lane it was given",
  );
  assert.deepEqual(side.through, [0], "the trunk crosses the side's row");

  // Both lanes were waiting for t2. It is drawn ONCE, in the leftmost, and the
  // other lane curves into it and closes — the mockup's own merge row.
  assert.equal(base.lane, 0);
  assert.deepEqual(base.joins, [1]);
  assert.deepEqual(base.through, []);
  assert.equal(base.down, false);
  assert.equal(graphWidth(rows), 2);
});

test("a merge parent a lane already carries is joined, not given a second column", () => {
  // `x` merges `a` and `b`; `y` is another tip whose own parent is `b`. The
  // second edge lands in the lane already carrying `b` rather than drawing a
  // fourth column for one commit, and `b` itself is drawn once — with `y`'s
  // lane curving into it.
  const rows = layoutCommitGraph(
    page(["x", "a", "b"], ["y", "b"], ["b", "z"], ["a", "z"], ["z"]),
  );
  assert.deepEqual(rows[0].forks, [1], "x's second parent opens lane 1");
  assert.equal(rows[1].lane, 2, "y is a tip and takes the next free column");
  const b = rows[2];
  assert.equal(b.lane, 1);
  assert.deepEqual(b.joins, [2], "y's lane converges here and closes");
  assert.deepEqual(b.through, [0]);
  // The root is where the last two lanes meet.
  assert.deepEqual(rows[4].joins, [1]);
  assert.equal(graphWidth(rows), 3);
});

test("a branch tip nothing points at starts its own lane with no line above", () => {
  // `--all` answers with several tips in one page. The second one is not a
  // continuation of anything on screen, and must not be drawn as one.
  const rows = layoutCommitGraph(
    page(["tip1", "root"], ["tip2", "root"], ["root"]),
  );
  assert.equal(rows[0].up, false);
  assert.equal(rows[1].up, false);
  assert.equal(rows[1].lane, 1, "the second tip takes the next free column");
  // Both lanes wait for `root`; it is drawn once, in the leftmost, with the
  // other curving in.
  assert.equal(rows[2].lane, 0);
  assert.equal(rows[2].up, true);
  assert.deepEqual(rows[2].joins, [1]);
});

test("a parent below the page leaves its lane open at the bottom edge", () => {
  // The page is bounded at 200 commits, so the oldest row's parent is a hash
  // nothing on screen will match. The line has to continue off the bottom —
  // closing it would say the repository begins here.
  const rows = layoutCommitGraph(page(["b", "a"]));
  assert.equal(rows[0].down, true);
  assert.equal(rows[0].up, false);
});

test("an empty page lays out to nothing and still has a column to not draw in", () => {
  assert.deepEqual(layoutCommitGraph([]), []);
  assert.equal(graphWidth([]), 1);
});

test("the drawing geometry is the mockup's own three numbers", () => {
  assert.equal(laneX(0), 12);
  assert.equal(laneX(1), 30);
  assert.equal(graphPixelWidth(2), 42, "the mockup's own .gsvg width");
  assert.equal(graphPixelWidth(1), 24);
});

test("lane colours cycle rather than running out", () => {
  assert.equal(laneColor(0), "#7fb2c9", "the mockup's trunk colour");
  assert.equal(laneColor(1), "var(--vingilot-accent)", "and its branch colour");
  assert.equal(laneColor(5), laneColor(0));
});

// ---------------------------------------------------------------------------
// The ceiling (redesign P4.3)
// ---------------------------------------------------------------------------

test("the dock's own width buys exactly the mockup's two-lane gutter", () => {
  // 376px is what the dock measured live when the owner sent his screenshot,
  // and the answer is the mockup's own `.gsvg`: 42px, two columns. Everything
  // wider than that is the subject's.
  assert.equal(laneBudget(376), MIN_LANES);
  assert.equal(graphPixelWidth(laneBudget(376)), 42);
  // A panel that has not been measured yet takes the narrowest layout rather
  // than a wide one it would have to take back on the first paint.
  assert.equal(laneBudget(0), MIN_LANES);
});

test("a full-width surface buys the braid, and the ceiling is still a number", () => {
  // The stage at his 16-inch default. This is the whole of "the full-width
  // History tab is where a big graph gets room".
  assert.ok(laneBudget(1100) > laneBudget(376));
  assert.ok(laneBudget(1100) >= 24, "this repository needs 24 lanes today");
  // And it does not run away: a 6000px window is not 300 lanes.
  assert.equal(laneBudget(6000), MAX_LANES);
});

test("the budget never eats the subject's floor", () => {
  // The defect this whole ceiling exists for, stated as an invariant: whatever
  // the width, what the lanes take plus the meta plus the subject's floor is
  // never more than the pane.
  for (const width of [200, 376, 540, 800, 1100, 1728]) {
    const spent = graphPixelWidth(laneBudget(width)) + META_PX + SUBJECT_MIN_PX;
    if (width >= 376) {
      assert.ok(spent <= width, `at ${width}px the graph took ${spent}px`);
    }
  }
});

test("the first-parent page is one lane, because a merge's other parent is not on it", () => {
  // `git log --first-parent` still REPORTS both parents of a merge; the second
  // names a commit no row carries. Laid out honestly it opens a lane that never
  // closes — six of them, measured on this repository — so the trunk reading
  // clips it and says "first-parent" in the header.
  const trunk = page(["m", "b", "side"], ["b", "a"], ["a"]);
  assert.equal(graphWidth(layoutCommitGraph(trunk)), 2);
  const clipped = layoutCommitGraph(trunk, { firstParentOnly: true });
  assert.equal(graphWidth(clipped), 1);
  assert.deepEqual(
    clipped.map((row) => row.forks),
    [[], [], []],
  );
});

test("the header says which reading is on screen", () => {
  assert.equal(scopeLabel("all-branches"), "all branches");
  assert.equal(scopeLabel("first-parent"), "first-parent");
});

test("a subject's conventional prefix is the half that gives way", () => {
  // The mockup's own sample data is written this way, and twenty rows of
  // `relay: ` is the one part of a history nobody is reading.
  assert.deepEqual(subjectParts("relay: heartbeat tuning for mesh reconnect"), {
    lead: "relay: ",
    name: "heartbeat tuning for mesh reconnect",
  });
  assert.deepEqual(subjectParts("feat(dock)!: bound the lane column"), {
    lead: "feat(dock)!: ",
    name: "bound the lane column",
  });
});

test("a subject that is a sentence is all name", () => {
  // The cost of a false positive is dimming half an English sentence, so the
  // rule is narrow: a capital first letter is prose, a long prefix is a clause,
  // and a colon with nothing after it is not a prefix at all.
  for (const subject of [
    "P4.1's own account enters the plan",
    "Note: this changes everything",
    "Merge #398 — surface cards grid",
    "the diff stops looking like terminal output: a rewrite of what it draws",
    "fix:",
  ]) {
    assert.deepEqual(subjectParts(subject), { lead: "", name: subject });
  }
});
