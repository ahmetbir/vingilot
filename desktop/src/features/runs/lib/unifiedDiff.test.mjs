import assert from "node:assert/strict";
import { test } from "node:test";

import { codeText, unifiedRows } from "./unifiedDiff.ts";

/** A patch exactly as `git diff` writes one, plumbing and all — which is what
 * the backend hands this app and what the owner's screenshot showed rendered
 * verbatim. */
const REAL = [
  "diff --git a/src/greet.ts b/src/greet.ts",
  "index 4dc47f0..9a1b2c3 100644",
  "--- a/src/greet.ts",
  "+++ b/src/greet.ts",
  "@@ -41,4 +41,5 @@ export function greet(name: string) {",
  "   const who = name.trim();",
  '-  return "hi " + who;',
  "+  if (who === '') return 'hi';",
  '+  return "hello " + who;',
  " }",
].join("\n");

test("git's wire format is dropped and the hunk keeps its human half", () => {
  const rows = unifiedRows(REAL);
  // Not one row of plumbing survives: no `diff --git`, no `index`, no
  // `---`/`+++`. The file row above the patch already names the file.
  assert.equal(
    rows.filter(
      (row) =>
        row.kind === "note" ||
        (row.kind === "line" && row.text.startsWith("diff --git")),
    ).length,
    0,
  );
  assert.deepEqual(rows[0], {
    context: "export function greet(name: string) {",
    kind: "hunk",
    range: "@@ -41,4 +41,5 @@",
  });
});

test("every line carries its number on each side, and its sign in a field", () => {
  const lines = unifiedRows(REAL).filter((row) => row.kind === "line");
  assert.deepEqual(
    lines.map((row) => [row.sign, row.before, row.after]),
    [
      [" ", 41, 41],
      ["-", 42, null],
      ["+", null, 42],
      ["+", null, 43],
      [" ", 43, 44],
    ],
  );
  // **And the code has lost its marker column.** This is the whole of "never
  // shift the code one character to the right": the sign is a field of the
  // row, so `-  return …` and `+  return …` start in the same place as the
  // context line above them.
  assert.deepEqual(
    lines.map((row) => row.text),
    [
      "  const who = name.trim();",
      '  return "hi " + who;',
      "  if (who === '') return 'hi';",
      '  return "hello " + who;',
      "}",
    ],
  );
});

test("a hunk header with no enclosing function keeps its ranges alone", () => {
  const rows = unifiedRows("@@ -1,2 +1,2 @@\n a\n-b\n+c\n");
  assert.deepEqual(rows[0], {
    context: "",
    kind: "hunk",
    range: "@@ -1,2 +1,2 @@",
  });
});

test("git's one-line range form is read rather than left unnumbered", () => {
  const rows = unifiedRows("@@ -7 +7 @@\n-old\n+new\n");
  const lines = rows.filter((row) => row.kind === "line");
  assert.deepEqual(
    lines.map((row) => [row.before, row.after]),
    [
      [7, null],
      [null, 7],
    ],
  );
});

test("a header shape this build cannot read leaves the numbers unknown, not wrong", () => {
  const rows = unifiedRows("@@ something else @@\n context\n");
  assert.deepEqual(rows[0], {
    context: "",
    kind: "hunk",
    range: "@@ something else @@",
  });
  // The context line after it is preamble as far as numbering goes — it is
  // kept, and it is kept as a note rather than as a line with invented
  // numbers beside it.
  assert.deepEqual(rows[1], { kind: "note", text: " context" });
});

test("what git printed that is not plumbing is kept as a note", () => {
  // The three that matter: a binary file's own sentence, the no-newline
  // marker, and the backend's truncation marker. Dropping any of them would
  // be this model deciding the owner does not need to know.
  const binary = unifiedRows(
    "diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n",
  );
  assert.deepEqual(binary, [
    { kind: "note", text: "Binary files a/logo.png and b/logo.png differ" },
  ]);

  const cut = unifiedRows(
    "@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n",
  );
  assert.deepEqual(cut.at(-1), {
    kind: "note",
    text: "\\ No newline at end of file",
  });

  const truncated = unifiedRows(
    "@@ -1,1 +1,1 @@\n a\n... [truncated, 4096 bytes total]",
  );
  assert.deepEqual(truncated.at(-1), {
    kind: "note",
    text: "... [truncated, 4096 bytes total]",
  });
});

test("a context line that looks like plumbing is still a line of the file", () => {
  // The exactness this rests on: inside a hunk every line carries a marker
  // column, so a real line reading `index abc` arrives with a leading space.
  const rows = unifiedRows(
    "@@ -1,2 +1,2 @@\n index 4dc47f0..9a1b2c3\n+diff --git something\n",
  );
  const lines = rows.filter((row) => row.kind === "line");
  assert.deepEqual(
    lines.map((row) => row.text),
    ["index 4dc47f0..9a1b2c3", "diff --git something"],
  );
});

test("a second file's preamble restarts the numbering rather than continuing it", () => {
  const rows = unifiedRows(
    [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,1 +1,1 @@",
      "-one",
      "diff --git a/b.ts b/b.ts",
      "index 1..2 100644",
      "@@ -90,1 +90,1 @@",
      "+two",
    ].join("\n"),
  );
  const lines = rows.filter((row) => row.kind === "line");
  assert.deepEqual(
    lines.map((row) => [row.before, row.after]),
    [
      [1, null],
      [null, 90],
    ],
  );
});

test("an empty patch is no rows at all", () => {
  assert.deepEqual(unifiedRows(""), []);
});

test("the highlighter is handed the lines and only the lines, in order", () => {
  // The agreement `PatchView` indexes tokens by: the nth line row is the nth
  // line of this text, so hunks and notes must not be in it.
  assert.equal(
    codeText(unifiedRows(REAL)),
    [
      "  const who = name.trim();",
      '  return "hi " + who;',
      "  if (who === '') return 'hi';",
      '  return "hello " + who;',
      "}",
    ].join("\n"),
  );
});
