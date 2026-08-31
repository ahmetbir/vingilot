import assert from "node:assert/strict";
import { test } from "node:test";
import { withoutWhitespaceChanges } from "./diffTab.ts";
import { pairRows } from "./splitDiff.ts";
import { unifiedRows } from "./unifiedDiff.ts";

// **What P4.8 changed about this file, and what it deliberately did not.**
// `pairRows` takes `unifiedRows`' output rather than the raw patch, so the two
// layouts cannot hold two models of one diff — the round's whole fix. Every
// alignment claim below is the one Task 2 made and is unchanged; what is new is
// that each row points back at the unified index it came from, which is what
// carries the word markup, the focused row, the comment affordance and the
// review threads into split without any of them being written twice.

/** `pairRows` over a patch, the way the component gets there. */
function pairs(patch) {
  return pairRows(unifiedRows(patch));
}

/** The rows a `change` block produced, as `[no, text] | null` pairs per side —
 * the shape the assertions below are about, which is *alignment* and not
 * styling. Each side reads ITS OWN file's number, which is the number that
 * side's gutter draws. */
function changes(rows) {
  return rows
    .filter((row) => row.kind === "change")
    .map((row) => [
      row.before === null ? null : [row.before.row.before, row.before.row.text],
      row.after === null ? null : [row.after.row.after, row.after.row.text],
    ]);
}

function kinds(rows) {
  return rows.map((row) => row.kind);
}

test("a one-for-one change puts the two lines on one row, numbered from the header", () => {
  const rows = pairs(
    "@@ -12,3 +30,3 @@\n ctx above\n-was this\n+is this\n ctx below",
  );
  assert.deepEqual(kinds(rows), ["hunk", "context", "change", "context"]);
  // The two counters run independently and both start where the header says. A
  // context row is ONE unified row drawn in two cells, so it carries one index
  // and both of its file's numbers.
  assert.equal(rows[1].row.before, 12);
  assert.equal(rows[1].row.after, 30);
  assert.equal(rows[1].row.text, "ctx above");
  assert.deepEqual(changes(rows), [
    [
      [13, "was this"],
      [31, "is this"],
    ],
  ]);
  assert.equal(rows[3].row.before, 14);
  assert.equal(rows[3].row.after, 32);
});

test("three deletions against one addition align, and the tail is empty on the right", () => {
  // The case the plan names: "hunks with uneven adds/dels align correctly". The
  // failure this pins is the one that matters — the sides sliding apart, so that
  // the second deletion appears beside a line it has nothing to do with.
  const rows = pairs("@@ -1,4 +1,2 @@\n-alpha\n-beta\n-gamma\n+one\n ctx");
  assert.deepEqual(changes(rows), [
    [
      [1, "alpha"],
      [1, "one"],
    ],
    [[2, "beta"], null],
    [[3, "gamma"], null],
  ]);
  // And the context line after the block is numbered past all four: three lines
  // gone from the old file, one arrived in the new.
  const ctx = rows.find((row) => row.kind === "context");
  assert.equal(ctx.row.before, 4);
  assert.equal(ctx.row.after, 2);
  assert.equal(ctx.row.text, "ctx");
});

test("one deletion against three additions aligns the other way round", () => {
  const rows = pairs("@@ -1,2 +1,4 @@\n-alpha\n+one\n+two\n+three\n ctx");
  assert.deepEqual(changes(rows), [
    [
      [1, "alpha"],
      [1, "one"],
    ],
    [null, [2, "two"]],
    [null, [3, "three"]],
  ]);
  const ctx = rows.find((row) => row.kind === "context");
  assert.equal(ctx.row.before, 2);
  assert.equal(ctx.row.after, 4);
});

test("two change blocks in one hunk pair within themselves and are not pooled", () => {
  // The bug a whole-hunk zip would have: the second block's addition ends up
  // beside the first block's leftover deletion, and every row after it is a
  // comparison between two unrelated lines.
  const rows = pairs("@@ -1,6 +1,5 @@\n-a1\n-a2\n+A1\n keep\n-b1\n+B1\n+B2\n");
  assert.deepEqual(kinds(rows), [
    "hunk",
    "change",
    "change",
    "context",
    "change",
    "change",
  ]);
  assert.deepEqual(changes(rows), [
    [
      [1, "a1"],
      [1, "A1"],
    ],
    [[2, "a2"], null],
    [
      [4, "b1"],
      [3, "B1"],
    ],
    [null, [4, "B2"]],
  ]);
});

test("every side carries the unified index it came from, in order and without gaps", () => {
  // **The P4.8 claim.** The word markup, the keyboard's focus, the comment
  // affordance and a thread's anchor are all keyed by a row's index in
  // `unifiedRows` — so a pairing that lost the index, or renumbered it, would be
  // a split layout that could not draw any of the four. Every line row of the
  // patch appears exactly once across the pairs, at its own index.
  const patch = "@@ -1,6 +1,5 @@\n-a1\n-a2\n+A1\n keep\n-b1\n+B1\n+B2\n";
  const rows = unifiedRows(patch);
  const seen = [];
  for (const pair of pairRows(rows)) {
    if (pair.kind === "context") seen.push(pair.at);
    if (pair.kind === "change") {
      if (pair.before !== null) seen.push(pair.before.at);
      if (pair.after !== null) seen.push(pair.after.at);
    }
  }
  const lines = rows
    .map((row, at) => (row.kind === "line" ? at : -1))
    .filter((at) => at !== -1);
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    lines,
  );
  // And the row each index names is the row that index really is — not a copy
  // this model made of it.
  for (const pair of pairRows(rows)) {
    if (pair.kind !== "change") continue;
    if (pair.before !== null)
      assert.equal(pair.before.row, rows[pair.before.at]);
    if (pair.after !== null) assert.equal(pair.after.row, rows[pair.after.at]);
  }
});

test("a filter over the rows reaches split, because split pairs the filtered rows", () => {
  // Until P4.8 "ignore whitespace" did nothing in split: the toolbar filtered
  // the unified rows and the split layout re-read the raw patch, so the two
  // modes showed a different number of lines for one toggle. One row model, one
  // answer.
  const patch = "@@ -1,3 +1,3 @@\n-  const x = 1;\n+const x = 1;\n keep\n";
  const all = unifiedRows(patch);
  const filtered = withoutWhitespaceChanges(all);
  assert.equal(filtered.hidden, 2);
  assert.equal(changes(pairRows(all)).length, 1);
  assert.equal(changes(pairRows(filtered.rows)).length, 0);
  assert.deepEqual(kinds(pairRows(filtered.rows)), ["hunk", "context"]);
});

test("a change row always has a side — the gap is never on both", () => {
  const rows = pairs("@@ -1,3 +1,3 @@\n-a\n-b\n-c\n+A\n+B\n+C\n+D\n+E\n");
  for (const row of rows.filter((r) => r.kind === "change")) {
    assert.ok(
      row.before !== null || row.after !== null,
      "a row with neither side is a row that draws nothing",
    );
  }
  // Five additions against three deletions is five rows, not eight.
  assert.equal(changes(rows).length, 5);
});

test("a new file has no left-hand side at all", () => {
  // git's own header for a creation. Nothing is numbered on the old side because
  // there is no old side, and that is the gap the grid draws.
  const rows = pairs("@@ -0,0 +1,2 @@\n+first\n+second\n");
  assert.deepEqual(changes(rows), [
    [null, [1, "first"]],
    [null, [2, "second"]],
  ]);
});

test("the marker column is stripped, and only when it is really there", () => {
  const rows = pairs("@@ -1,2 +1,2 @@\n-  indented old\n+  indented new");
  assert.deepEqual(changes(rows), [
    [
      [1, "  indented old"],
      [1, "  indented new"],
    ],
  ]);
  // A context line whose leading space some tool trimmed away is code, not a
  // marker. Eating its first character would be this model deleting source.
  const trimmed = pairs("@@ -1 +1 @@\nconst x = 1;");
  assert.equal(trimmed[1].kind, "context");
  assert.equal(trimmed[1].row.text, "const x = 1;");
  assert.equal(trimmed[1].row.before, 1);
  assert.equal(trimmed[1].row.after, 1);
});

test("the no-newline marker belongs to neither column and advances neither counter", () => {
  const rows = pairs(
    "@@ -1,2 +1,2 @@\n-old tail\n\\ No newline at end of file\n+new tail\n\\ No newline at end of file\n",
  );
  assert.deepEqual(kinds(rows), ["hunk", "change", "note", "change", "note"]);
  // Both marker rows are notes, and the addition after the first one is still
  // line 1 of the new file — a marker that had advanced a counter would have
  // made it 2. The marker also CLOSES the block, which is why the deletion and
  // the addition are two rows rather than one pair.
  assert.deepEqual(changes(rows), [
    [[1, "old tail"], null],
    [null, [1, "new tail"]],
  ]);
});

test("a truncation marker is a note; git's own wire format is not drawn at all", () => {
  // The executor's own cut marker — `runModel.ts`'s `TRUNCATION_MARKER`, matched
  // verbatim so this goes red if that regex moves — must not sit inside a
  // column, and it must end whatever block was open, or a deletion above it
  // pairs with an addition from after the cut.
  //
  // **And `---`/`+++` are gone rather than spanned.** They are git's wire format
  // and `unifiedDiff.ts` drops them for both layouts now; split drew them
  // verbatim until P4.6 special-cased them in the component, which is a filter
  // that could only ever be in one of the two renderings. One model, one answer.
  const rows = pairs(
    "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-old\n... [truncated, 262144 bytes total]\n+new\n",
  );
  assert.deepEqual(kinds(rows), ["hunk", "change", "note", "change"]);
  assert.deepEqual(
    rows.filter((row) => row.kind === "note").map((row) => row.text),
    ["... [truncated, 262144 bytes total]"],
  );
  assert.deepEqual(changes(rows), [
    [[1, "old"], null],
    [null, [1, "new"]],
  ]);
});

test("git's preamble is preamble, not a context line of line zero", () => {
  // `diff --git` and `index` have no marker column, so `diffView` hands them
  // over as context. Before the first hunk header there are no counters to
  // number them from, and a row numbered from a counter that has not started
  // would put two files' preamble in the middle of a column of source. They are
  // plumbing, so neither layout draws them.
  const rows = pairs(
    "diff --git a/x.ts b/x.ts\nindex 1111111..2222222 100644\n@@ -5 +5 @@\n-old\n+new\n",
  );
  assert.deepEqual(kinds(rows), ["hunk", "change"]);
  assert.deepEqual(changes(rows), [
    [
      [5, "old"],
      [5, "new"],
    ],
  ]);
});

test("a hunk header this model cannot read numbers nothing rather than guessing", () => {
  const rows = pairs("@@ garbled @@\n-old\n+new\n ctx");
  assert.deepEqual(changes(rows), [
    [
      [null, "old"],
      [null, "new"],
    ],
  ]);
  // And the context line that follows it is preamble by the same rule: there is
  // no counter to number it from, so it is a note rather than claiming line 1.
  assert.deepEqual(kinds(rows), ["hunk", "change", "note"]);
});

test("the trailing newline of a patch string is not a line of anybody's file", () => {
  // `diffView` splits on "\n", so a patch ending in one arrives with a trailing
  // empty context line. Numbering it would put a phantom line at the end of
  // every diff with a number beside it that is a lie.
  const rows = pairs("@@ -1 +1 @@\n-old\n+new\n");
  assert.deepEqual(kinds(rows), ["hunk", "change"]);
  // An empty line in the MIDDLE is a real blank line of both files and keeps
  // its numbers — the rule is about the tail, not about emptiness.
  const middle = pairs("@@ -1,2 +1,2 @@\n \n ctx\n");
  assert.deepEqual(kinds(middle), ["hunk", "context", "context"]);
  assert.equal(middle[1].row.before, 1);
  assert.equal(middle[1].row.text, "");
});

test("an empty patch is no rows", () => {
  assert.deepEqual(pairs(""), []);
});
