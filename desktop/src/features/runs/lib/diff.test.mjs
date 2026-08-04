import assert from "node:assert/strict";
import { test } from "node:test";
import { diffView } from "./runModel.ts";

test("diffView classifies +++/--- file headers as meta, not add/del", () => {
  const raw = ["--- a/foo.txt", "+++ b/foo.txt"].join("\n");
  const { lines, truncated } = diffView(raw);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["meta", "meta"],
  );
  assert.equal(truncated, false);
});

test("diffView classifies @@ hunk headers as hunk", () => {
  const { lines } = diffView("@@ -1,3 +1,4 @@");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["hunk"],
  );
});

test("diffView classifies + lines (not +++) as add", () => {
  const { lines } = diffView("+hello");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["add"],
  );
});

test("diffView classifies - lines (not ---) as del", () => {
  const { lines } = diffView("-hello");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["del"],
  );
});

test("diffView classifies a context line starting with a space as ctx", () => {
  const { lines } = diffView(" unchanged line");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["ctx"],
  );
});

test("diffView classifies everything else (no prefix) as ctx", () => {
  const { lines } = diffView("diff --git a/foo.txt b/foo.txt");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["ctx"],
  );
});

test("diffView detects the executor's truncation marker and sets truncated", () => {
  const raw = ["+hello", "... [truncated, 98765 bytes total]"].join("\n");
  const { lines, truncated } = diffView(raw);
  assert.equal(truncated, true);
  assert.equal(lines.at(-1).text, "... [truncated, 98765 bytes total]");
});

test("diffView on a full realistic diff classifies each line correctly", () => {
  const raw = [
    "diff --git a/PROOF.txt b/PROOF.txt",
    "index 0000000..a1b2c3d 100644",
    "--- /dev/null",
    "+++ b/PROOF.txt",
    "@@ -0,0 +1 @@",
    "+hello",
  ].join("\n");
  const { lines } = diffView(raw);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["ctx", "ctx", "meta", "meta", "hunk", "add"],
  );
});

test("diffView on an empty diff returns empty lines and truncated false", () => {
  const { lines, truncated } = diffView("");
  assert.deepEqual(lines, []);
  assert.equal(truncated, false);
});
