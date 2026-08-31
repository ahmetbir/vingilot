import assert from "node:assert/strict";
import { test } from "node:test";

import {
  graphPixelWidth,
  graphWidth,
  laneColor,
  laneX,
  layoutCommitGraph,
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
