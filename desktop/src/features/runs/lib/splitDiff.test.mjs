import assert from "node:assert/strict";
import { test } from "node:test";
import { splitRows } from "./splitDiff.ts";

/** The rows a `change` block produced, as `[beforeNo, beforeText] | null` pairs
 * per side — the shape the assertions below are about, which is *alignment* and
 * not styling. */
function changes(rows) {
  return rows
    .filter((row) => row.kind === "change")
    .map((row) => [
      row.before === null ? null : [row.before.no, row.before.text],
      row.after === null ? null : [row.after.no, row.after.text],
    ]);
}

function kinds(rows) {
  return rows.map((row) => row.kind);
}

test("a one-for-one change puts the two lines on one row, numbered from the header", () => {
  const rows = splitRows(
    "@@ -12,3 +30,3 @@\n ctx above\n-was this\n+is this\n ctx below",
  );
  assert.deepEqual(kinds(rows), ["span", "context", "change", "context"]);
  // The two counters run independently and both start where the header says.
  assert.deepEqual(rows[1], {
    after: { no: 30, text: "ctx above" },
    before: { no: 12, text: "ctx above" },
    kind: "context",
  });
  assert.deepEqual(changes(rows), [
    [
      [13, "was this"],
      [31, "is this"],
    ],
  ]);
  assert.deepEqual(rows[3], {
    after: { no: 32, text: "ctx below" },
    before: { no: 14, text: "ctx below" },
    kind: "context",
  });
});

test("three deletions against one addition align, and the tail is empty on the right", () => {
  // The case the plan names: "hunks with uneven adds/dels align correctly". The
  // failure this pins is the one that matters — the sides sliding apart, so that
  // the second deletion appears beside a line it has nothing to do with.
  const rows = splitRows("@@ -1,4 +1,2 @@\n-alpha\n-beta\n-gamma\n+one\n ctx");
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
  assert.deepEqual(ctx.before, { no: 4, text: "ctx" });
  assert.deepEqual(ctx.after, { no: 2, text: "ctx" });
});

test("one deletion against three additions aligns the other way round", () => {
  const rows = splitRows("@@ -1,2 +1,4 @@\n-alpha\n+one\n+two\n+three\n ctx");
  assert.deepEqual(changes(rows), [
    [
      [1, "alpha"],
      [1, "one"],
    ],
    [null, [2, "two"]],
    [null, [3, "three"]],
  ]);
  const ctx = rows.find((row) => row.kind === "context");
  assert.deepEqual(ctx.before, { no: 2, text: "ctx" });
  assert.deepEqual(ctx.after, { no: 4, text: "ctx" });
});

test("two change blocks in one hunk pair within themselves and are not pooled", () => {
  // The bug a whole-hunk zip would have: the second block's addition ends up
  // beside the first block's leftover deletion, and every row after it is a
  // comparison between two unrelated lines.
  const rows = splitRows(
    "@@ -1,6 +1,5 @@\n-a1\n-a2\n+A1\n keep\n-b1\n+B1\n+B2\n",
  );
  assert.deepEqual(kinds(rows), [
    "span",
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

test("a change row always has a side — the gap is never on both", () => {
  const rows = splitRows("@@ -1,3 +1,3 @@\n-a\n-b\n-c\n+A\n+B\n+C\n+D\n+E\n");
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
  const rows = splitRows("@@ -0,0 +1,2 @@\n+first\n+second\n");
  assert.deepEqual(changes(rows), [
    [null, [1, "first"]],
    [null, [2, "second"]],
  ]);
});

test("the marker column is stripped, and only when it is really there", () => {
  const rows = splitRows("@@ -1,2 +1,2 @@\n-  indented old\n+  indented new");
  assert.deepEqual(changes(rows), [
    [
      [1, "  indented old"],
      [1, "  indented new"],
    ],
  ]);
  // A context line whose leading space some tool trimmed away is code, not a
  // marker. Eating its first character would be this model deleting source.
  const trimmed = splitRows("@@ -1 +1 @@\nconst x = 1;");
  assert.deepEqual(trimmed[1], {
    after: { no: 1, text: "const x = 1;" },
    before: { no: 1, text: "const x = 1;" },
    kind: "context",
  });
});

test("the no-newline marker belongs to neither column and advances neither counter", () => {
  const rows = splitRows(
    "@@ -1,2 +1,2 @@\n-old tail\n\\ No newline at end of file\n+new tail\n\\ No newline at end of file\n",
  );
  assert.deepEqual(kinds(rows), ["span", "change", "span", "change", "span"]);
  // Both marker rows span, and the addition after the first one is still line 1
  // of the new file — a marker that had advanced a counter would have made it 2.
  assert.deepEqual(changes(rows), [
    [[1, "old tail"], null],
    [null, [1, "new tail"]],
  ]);
});

test("a truncation marker and the ---/+++ headers span, and they close the block", () => {
  // The executor's own cut marker — `runModel.ts`'s `TRUNCATION_MARKER`, matched
  // verbatim so this goes red if that regex moves — must not sit inside a
  // column, and it must end whatever block was open, or a deletion above it
  // pairs with an addition from after the cut.
  const rows = splitRows(
    "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n-old\n... [truncated, 262144 bytes total]\n+new\n",
  );
  const spans = rows.filter((row) => row.kind === "span").map((r) => r.text);
  assert.deepEqual(spans, [
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,2 @@",
    "... [truncated, 262144 bytes total]",
  ]);
  assert.deepEqual(changes(rows), [
    [[1, "old"], null],
    [null, [1, "new"]],
  ]);
});

test("git's preamble is preamble, not a context line of line zero", () => {
  // `diff --git` and `index` have no marker column, so `diffView` hands them
  // over as context. Before the first hunk header there are no counters to
  // number them from, and a row numbered from a counter that has not started
  // would put two files' preamble in the middle of a column of source.
  const rows = splitRows(
    "diff --git a/x.ts b/x.ts\nindex 1111111..2222222 100644\n@@ -5 +5 @@\n-old\n+new\n",
  );
  assert.deepEqual(kinds(rows), ["span", "span", "span", "change"]);
  assert.deepEqual(changes(rows), [
    [
      [5, "old"],
      [5, "new"],
    ],
  ]);
});

test("a hunk header this model cannot read numbers nothing rather than guessing", () => {
  const rows = splitRows("@@ garbled @@\n-old\n+new\n ctx");
  assert.deepEqual(changes(rows), [
    [
      [null, "old"],
      [null, "new"],
    ],
  ]);
  // And the context line that follows it is preamble by the same rule: there is
  // no counter to number it from, so it spans rather than claiming line 1.
  assert.deepEqual(kinds(rows), ["span", "change", "span"]);
});

test("the trailing newline of a patch string is not a line of anybody's file", () => {
  // `diffView` splits on "\n", so a patch ending in one arrives with a trailing
  // empty context line. Numbering it would put a phantom line at the end of
  // every diff with a number beside it that is a lie.
  const rows = splitRows("@@ -1 +1 @@\n-old\n+new\n");
  assert.deepEqual(kinds(rows), ["span", "change"]);
  // An empty line in the MIDDLE is a real blank line of both files and keeps
  // its numbers — the rule is about the tail, not about emptiness.
  const middle = splitRows("@@ -1,2 +1,2 @@\n \n ctx\n");
  assert.deepEqual(kinds(middle), ["span", "context", "context"]);
  assert.deepEqual(middle[1].before, { no: 1, text: "" });
});

test("an empty patch is no rows", () => {
  assert.deepEqual(splitRows(""), []);
});
